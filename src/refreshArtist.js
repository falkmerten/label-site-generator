'use strict'

const bandcamp = require('./bandcamp.js')
const { readCache, writeCache } = require('./cache')
const { toSlug } = require('./slugs')
const readline = require('readline')

const DELAY_MS = 1500

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * All album-level enrichment fields that must be preserved during re-scrape.
 */
const ALBUM_ENRICHMENT_FIELDS = [
  'streamingLinks', 'upc', 'discogsUrl', 'discogsChecked', 'enrichmentChecked', 'discogsSellUrl',
  'discogsSellUrlVinyl', 'discogsSellUrlCd', 'discogsSellUrlCassette',
  'physicalFormats', 'catalogNumber', 'labelName', 'labelUrl', 'labelUrls',
  'videos', 'soundchartsUuid', 'soundchartsEnriched', 'spotifyLabel',
  'distributor', 'copyright', 'discogsLabel', 'discogsLabelUrls', 'presaveUrl'
  // NOTE: description, releaseDate, slug are NOT enrichment fields — they come
  // from Bandcamp scrape and should be updated when the artist page changes.
  // Discogs notes are stored in raw, not in description directly.
]

/**
 * All artist-level enrichment fields that must be preserved during re-scrape.
 */
const ARTIST_ENRICHMENT_FIELDS = [
  'streamingLinks', 'socialLinks', 'discoveryLinks', 'eventLinks',
  'events', 'soundchartsUuid'
]

/**
 * Computes the Levenshtein distance between two strings.
 * Returns a ratio between 0 (identical) and 1 (completely different).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshteinRatio (a, b) {
  if (!a && !b) return 0
  if (!a || !b) return 1
  const la = a.length
  const lb = b.length
  if (la === 0 && lb === 0) return 0
  if (la === 0 || lb === 0) return 1

  const matrix = Array.from({ length: la + 1 }, (_, i) => {
    const row = new Array(lb + 1)
    row[0] = i
    return row
  })
  for (let j = 0; j <= lb; j++) matrix[0][j] = j

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }

  const distance = matrix[la][lb]
  return distance / Math.max(la, lb)
}

/**
 * Detects significant conflicts between cached and scraped artist data.
 * @param {object} cachedArtist
 * @param {Array} scrapedAlbums - newly scraped albums
 * @returns {Array} conflicts - array of { albumUrl, field, oldValue, newValue }
 */
function detectConflicts (cachedArtist, scrapedAlbums) {
  const conflicts = []
  const cachedAlbums = cachedArtist.albums || []

  for (const scraped of scrapedAlbums) {
    const cached = cachedAlbums.find(a => a.url === scraped.url)
    if (!cached) continue

    // Title change (case-insensitive)
    const cachedTitle = (cached.title || '').trim()
    const scrapedTitle = (scraped.title || '').trim()
    if (cachedTitle.toLowerCase() !== scrapedTitle.toLowerCase() && cachedTitle && scrapedTitle) {
      conflicts.push({
        albumUrl: scraped.url,
        field: 'title',
        oldValue: cachedTitle,
        newValue: scrapedTitle
      })
    }

    // Track count differs by more than 1
    const cachedTrackCount = (cached.tracks || []).length
    const scrapedTrackCount = (scraped.tracks || []).length
    if (Math.abs(cachedTrackCount - scrapedTrackCount) > 1) {
      conflicts.push({
        albumUrl: scraped.url,
        field: 'trackCount',
        oldValue: String(cachedTrackCount),
        newValue: String(scrapedTrackCount)
      })
    }

    // Description changed by more than 20%
    const cachedDesc = cached.description || (cached.raw && cached.raw.current && cached.raw.current.about) || ''
    const scrapedDesc = (scraped.raw && scraped.raw.current && scraped.raw.current.about) || ''
    if (cachedDesc && scrapedDesc) {
      const ratio = levenshteinRatio(cachedDesc, scrapedDesc)
      if (ratio > 0.2) {
        conflicts.push({
          albumUrl: scraped.url,
          field: 'description',
          oldValue: cachedDesc.slice(0, 80) + (cachedDesc.length > 80 ? '...' : ''),
          newValue: scrapedDesc.slice(0, 80) + (scrapedDesc.length > 80 ? '...' : '')
        })
      }
    }
  }

  return conflicts
}

/**
 * Prompts the user to resolve conflicts. In non-interactive mode, defaults to 'keep cached'.
 * @param {Array} conflicts
 * @returns {Promise<string>} 'keep-cached' | 'overwrite'
 */
async function promptConflictResolution (conflicts) {
  // Display conflict summary
  console.log(`\n  ⚠ ${conflicts.length} conflict(s) detected:`)
  for (const c of conflicts) {
    console.log(`    ${c.field} @ ${c.albumUrl}`)
    console.log(`      cached:  ${c.oldValue}`)
    console.log(`      scraped: ${c.newValue}`)
  }

  // Non-interactive mode: default to keep cached
  const isInteractive = process.stdin.isTTY && !process.env.CI
  if (!isInteractive) {
    console.log('  → Non-interactive mode: keeping cached data (default)')
    return 'keep-cached'
  }

  // Interactive prompt
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question('\n  Choose: (k)eep cached data [default] / (o)verwrite with scraped data? ', answer => {
      rl.close()
      const choice = (answer || '').trim().toLowerCase()
      if (choice === 'o' || choice === 'overwrite') {
        resolve('overwrite')
      } else {
        resolve('keep-cached')
      }
    })
  })
}

/**
 * Re-scrapes a single artist and updates the cache in place.
 * Matches by artist name or slug.
 * Preserves all enrichment fields and retains albums that disappear from Bandcamp.
 *
 * @param {string} cachePath
 * @param {string} artistFilter - artist name or slug to match
 */
async function refreshArtist (cachePath, artistFilter) {
  const data = await readCache(cachePath)
  if (!data) {
    console.error('[refresh-artist] No cache found — run without flags first.')
    return
  }

  const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const filterNorm = normalise(artistFilter)

  const artist = data.artists.find(a =>
    normalise(a.name) === filterNorm || toSlug(a.name) === artistFilter.toLowerCase()
  )

  if (!artist) {
    console.error(`[refresh-artist] Artist not found: "${artistFilter}"`)
    console.log('Available artists:', data.artists.map(a => a.name).join(', '))
    return
  }

  console.log(`Re-scraping ${artist.name} (${artist.url})...`)

  let artistInfo
  try {
    await delay(DELAY_MS)
    artistInfo = await bandcamp.getArtistInfo(artist.url)
  } catch (err) {
    console.error(`  Error fetching artist info: ${err.message}`)
    return
  }

  // Use getAlbumUrls (/music) to get the complete album list
  let albumUrls = []
  try {
    await delay(DELAY_MS)
    albumUrls = await bandcamp.getAlbumUrls(artist.url)
  } catch (err) {
    console.warn(`  Could not fetch full album list, using artist page albums`)
    albumUrls = (artistInfo.albums || []).map(a => a.url)
  }
  if (albumUrls.length === 0) albumUrls = (artistInfo.albums || []).map(a => a.url)

  const scrapedAlbums = []
  for (const albumUrl of albumUrls) {
    try {
      console.log(`  → Album: ${albumUrl}`)
      await delay(DELAY_MS)
      const albumInfo = await bandcamp.getAlbumInfo(albumUrl)
      if (albumInfo) {
        scrapedAlbums.push({
          url: albumUrl,
          title: albumInfo.title,
          artist: albumInfo.artist,
          imageUrl: albumInfo.imageUrl,
          tracks: albumInfo.tracks,
          tags: albumInfo.tags,
          raw: albumInfo.raw
        })
      }
    } catch (err) {
      console.error(`    Error fetching album: ${err.message}`)
    }
  }

  console.log(`  ✓ ${artistInfo.name} — ${scrapedAlbums.length} album(s) scraped`)

  // Detect conflicts before applying changes
  const conflicts = detectConflicts(artist, scrapedAlbums)
  let resolution = 'overwrite'
  if (conflicts.length > 0) {
    resolution = await promptConflictResolution(conflicts)
    console.log(`  → Resolution: ${resolution}`)
  }

  // Build final album list, preserving enrichment fields
  const scrapedUrlSet = new Set(albumUrls)
  const albums = []

  for (const scraped of scrapedAlbums) {
    const existing = artist.albums.find(a => a.url === scraped.url)
    const album = { ...scraped }

    // Preserve all enrichment fields from existing cached album
    if (existing) {
      for (const field of ALBUM_ENRICHMENT_FIELDS) {
        if (existing[field] !== undefined && existing[field] !== null) {
          album[field] = existing[field]
        }
      }

      // Preserve releaseDate — Spotify/Soundcharts dates (set during enrichment)
      // are authoritative over Bandcamp dates. Always keep the existing date if set.
      if (existing.releaseDate) {
        album.releaseDate = existing.releaseDate
      }

      // Preserve slug from existing if title didn't change
      if (existing.slug && album.title === existing.title) {
        album.slug = existing.slug
      }

      // If resolution is 'keep-cached', keep cached scraped fields too
      if (resolution === 'keep-cached') {
        album.title = existing.title || scraped.title
        album.tracks = (existing.tracks && existing.tracks.length > 0) ? existing.tracks : scraped.tracks
        if (existing.raw && existing.raw.current && existing.raw.current.about) {
          album.raw = album.raw || {}
          album.raw.current = album.raw.current || {}
          album.raw.current.about = existing.raw.current.about
        }
      }
    }

    albums.push(album)
  }

  // Retain cached albums not found during re-scrape
  for (const cached of (artist.albums || [])) {
    if (cached.url && !scrapedUrlSet.has(cached.url)) {
      console.warn(`  ⚠ Album not found during re-scrape, retaining cached: "${cached.title}" (${cached.url})`)
      albums.push(cached)
    } else if (!cached.url) {
      // Spotify-only or upcoming albums (no Bandcamp URL) — always retain
      console.log(`  ↩ Retaining non-Bandcamp album: "${cached.title}"${cached.upcoming ? ' (upcoming)' : ' (Spotify-only)'}`)
      albums.push(cached)
    }
  }

  // Update artist in cache, preserving artist-level enrichment fields
  const idx = data.artists.findIndex(a => a.url === artist.url)
  const updatedArtist = {
    ...artist,
    name: artistInfo.name,
    location: artistInfo.location,
    description: artistInfo.description,
    coverImage: artistInfo.coverImage,
    bandLinks: artistInfo.bandLinks,
    albums
  }

  // Preserve artist-level enrichment fields
  for (const field of ARTIST_ENRICHMENT_FIELDS) {
    if (artist[field] !== undefined && artist[field] !== null) {
      updatedArtist[field] = artist[field]
    }
  }

  data.artists[idx] = updatedArtist

  // Spotify title normalization — if artist has a Spotify URL, normalize titles
  try {
    const { loadArtistConfig } = require('./enricher')
    const { getAccessToken, fetchArtistAlbums } = require('./spotify')
    const contentDir = process.env.CONTENT_DIR || './content'
    const artistConfig = await loadArtistConfig(contentDir)
    const artistSlug = toSlug(updatedArtist.name)
    const config = artistConfig[artistSlug] || artistConfig[updatedArtist.name]
    const spotifyUrl = config && config.spotifyArtistUrl

    if (spotifyUrl && process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
      console.log('  → Normalizing titles against Spotify...')
      const token = await getAccessToken(process.env.SPOTIFY_CLIENT_ID, process.env.SPOTIFY_CLIENT_SECRET)
      const spotifyAlbums = await fetchArtistAlbums(token, spotifyUrl)
      if (spotifyAlbums.length > 0) {
        const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
        let normalized = 0
        for (const album of updatedArtist.albums) {
          const match = spotifyAlbums.find(sa => normalise(sa.title) === normalise(album.title))
          if (match && match.title !== album.title) {
            console.log(`    ✓ Title: "${album.title}" → "${match.title}"`)
            album.title = match.title
            normalized++
          }
        }
        if (normalized > 0) console.log(`  ✓ Normalized ${normalized} title(s)`)
      }
    }
  } catch (err) {
    console.warn(`  ⚠ Spotify title normalization skipped: ${err.message}`)
  }

  // Load upcoming releases for this artist from upcoming.json
  const { loadUpcoming } = require('./upcoming')
  const contentDir = process.env.CONTENT_DIR || './content'
  const upcomingCount = await loadUpcoming(contentDir, data, artistFilter)
  if (upcomingCount > 0) {
    console.log(`Added ${upcomingCount} upcoming release(s) for ${artistInfo.name}.`)
  }

  await writeCache(cachePath, data)
  console.log(`Cache updated for ${artistInfo.name}.`)
}

module.exports = {
  refreshArtist,
  levenshteinRatio,
  detectConflicts,
  promptConflictResolution,
  ALBUM_ENRICHMENT_FIELDS,
  ARTIST_ENRICHMENT_FIELDS
}
