'use strict'

const fs = require('fs/promises')
const path = require('path')
const bandcamp = require('./bandcamp')
const { toSlug } = require('./slugs')

const DELAY_MS = 1500

/**
 * Loads upcoming releases from content/upcoming.json.
 * Fetches metadata from private Bandcamp stream links and adds
 * them to the raw data as upcoming releases.
 *
 * @param {string} contentDir - path to content directory
 * @param {object} rawData - the raw site data (mutated in place)
 * @param {string} [artistFilter] - optional artist name/slug to limit loading
 * @returns {Promise<number>} number of upcoming releases added
 */
async function loadUpcoming (contentDir, rawData, artistFilter) {
  let config
  try {
    const raw = await fs.readFile(path.join(contentDir, 'upcoming.json'), 'utf8')
    config = JSON.parse(raw)
  } catch {
    return 0 // no upcoming.json
  }

  const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  let count = 0

  for (const [artistSlug, urls] of Object.entries(config)) {
    if (!Array.isArray(urls) || urls.length === 0) continue

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

    for (const entry of urls) {
      // Support both string format ("url") and object format ({ url, presaveUrl })
      const privateUrl = typeof entry === 'string' ? entry : entry.url
      const presaveUrl = typeof entry === 'object' ? entry.presaveUrl || null : null
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
          // Re-scrape: update cached data from fresh private link
          existing.presaveUrl = presaveUrl
          if (info.raw) existing.raw = info.raw
          if (info.tracks && info.tracks.length > 0) existing.tracks = info.tracks
          if (info.tags && info.tags.length > 0) existing.tags = info.tags
          if (info.imageUrl) existing.imageUrl = info.imageUrl
          if (releaseDate) existing.releaseDate = releaseDate
          if (existing.upcoming) {
            console.log(`  ✓ Upcoming "${info.title}" re-scraped from private link`)
          }
          continue
        }

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
          slug: toSlug(info.title),
          upcoming: true
        })

        console.log(`  ✓ Upcoming: "${info.title}" by ${info.artist} (${releaseDate || 'no date'})`)
        count++
      } catch (err) {
        console.warn(`  ⚠ Could not fetch upcoming release ${privateUrl}: ${err.message}`)
      }
    }
  }

  return count
}

module.exports = { loadUpcoming }
