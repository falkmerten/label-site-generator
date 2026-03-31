'use strict'

const https = require('https')

const ODESLI_API = 'https://api.song.link/v1-alpha.1/links'

// 10 req/min = 1 req per 6s. Use 8s to account for network latency and burst protection.
const MIN_INTERVAL_MS = 8000

// Global rate limiter — tracks when the last request was made
let _lastRequestAt = 0

/**
 * Waits until at least MIN_INTERVAL_MS has passed since the last request.
 */
async function rateLimitedWait () {
  const now = Date.now()
  const elapsed = now - _lastRequestAt
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed))
  }
  _lastRequestAt = Date.now()
}

/**
 * Fetches streaming links for a given URL via the Odesli (song.link) API.
 * Accepts any URL that Odesli understands: Bandcamp, Spotify, Apple Music, etc.
 *
 * @param {string} url - A Bandcamp, Spotify, or other supported platform URL
 * @returns {Promise<object|null>} Streaming links keyed by platform, or null on failure
 */
async function fetchStreamingLinks (url) {
  await rateLimitedWait()

  return new Promise((resolve) => {
    const apiUrl = `${ODESLI_API}?url=${encodeURIComponent(url)}&userCountry=US`
    https.get(apiUrl, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        if (res.statusCode === 404 || res.statusCode === 400) {
          return resolve(null)
        }
        if (res.statusCode === 429) {
          // Back off: reset the timer so next call waits a full extra interval
          console.warn('  [odesli] Rate limited (429) — backing off 30s...')
          _lastRequestAt = Date.now() + 30000
          return resolve(null)
        }
        try {
          const data = JSON.parse(raw)
          resolve(extractLinks(data))
        } catch {
          resolve(null)
        }
      })
    }).on('error', () => resolve(null))
  })
}

/**
 * Extracts a flat map of platform → URL from the Odesli response.
 * Only includes platforms we care about rendering.
 */
function extractLinks (data) {
  if (!data || !data.linksByPlatform) return null

  const platforms = {
    spotify: 'spotify',
    appleMusic: 'appleMusic',
    deezer: 'deezer',
    tidal: 'tidal',
    youtubeMusic: 'youtubeMusic',
    soundcloud: 'soundcloud',
    amazonMusic: 'amazonMusic',
  }

  const links = {}
  for (const [key, platformId] of Object.entries(platforms)) {
    const entry = data.linksByPlatform[platformId]
    if (entry && entry.url) {
      links[key] = entry.url
    }
  }

  return Object.keys(links).length > 0 ? links : null
}

/**
 * Enriches an array of albums with streaming links from Odesli.
 * Mutates each album object in place, adding a `streamingLinks` property.
 *
 * @param {Array} albums - Array of album objects with a `url` property
 * @param {string} artistName - Used for logging
 */
async function enrichAlbumsWithStreamingLinks (albums, artistName) {
  for (const album of albums) {
    if (!album.url) continue
    try {
      const links = await fetchStreamingLinks(album.url)
      if (links) {
        album.streamingLinks = links
        console.log(`    ✓ "${album.title}" → ${Object.keys(links).join(', ')}`)
      } else {
        console.log(`    – "${album.title}" → no links found`)
      }
    } catch (err) {
      console.warn(`    ⚠ Odesli failed for "${album.title}": ${err.message}`)
    }
  }
}

/**
 * Fetches streaming links for an artist's Bandcamp URL.
 *
 * @param {string} artistUrl
 * @returns {Promise<object|null>}
 */
async function fetchArtistStreamingLinks (artistUrl) {
  try {
    return await fetchStreamingLinks(artistUrl)
  } catch {
    return null
  }
}

module.exports = { enrichAlbumsWithStreamingLinks, fetchArtistStreamingLinks, fetchStreamingLinks }
