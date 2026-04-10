'use strict'

const https = require('https')

const DELAY_MS = 200

/**
 * @typedef {Object} Track
 * @property {number} trackNumber
 * @property {string} title
 * @property {string|null} isrc
 * @property {string[]} authors   - always empty (credits not available via public API)
 * @property {string[]} composers - always empty (credits not available via public API)
 * @property {string[]} producers - always empty (credits not available via public API)
 */

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function spotifyGet (token, path) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.spotify.com',
      path,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }
    https.get(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(raw) })
        } catch {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: null })
        }
      })
    }).on('error', () => resolve({ statusCode: 0, headers: {}, body: null }))
  })
}

/**
 * Wraps spotifyGet with exponential backoff on 429 responses.
 * Bails immediately if Retry-After exceeds 60s (quota exhausted).
 */
const MAX_RETRIES = 3

async function spotifyGetWithRetry (token, path) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await spotifyGet(token, path)
    if (result.statusCode !== 429) return result

    const retryAfter = parseInt(result.headers['retry-after'] || '1', 10)
    if (retryAfter > 60) {
      console.warn(`[warn] Rate limit: Spotify requests a ${retryAfter}s wait — quota likely exhausted. Try again later.`)
      return { statusCode: 429, headers: {}, body: null }
    }

    // Exponential backoff capped at 30s
    const backoff = Math.min(retryAfter * Math.pow(2, attempt), 30)
    console.warn(`[warn] Rate limited on ${path} — waiting ${backoff}s (attempt ${attempt + 1}/${MAX_RETRIES})`)
    await delay(backoff * 1000)
  }
  console.warn(`[warn] Rate limit: max retries exceeded for ${path}, skipping`)
  return { statusCode: 429, headers: {}, body: null }
}

/**
 * Fetches all tracks for an album using GET /v1/albums/{id}/tracks (paginated).
 * Each track item from this endpoint includes external_ids.isrc directly,
 * avoiding the need for per-track GET /v1/tracks/{id} calls.
 *
 * Per Spotify best practices, batch endpoints are preferred to reduce request volume.
 * See: https://developer.spotify.com/documentation/web-api/concepts/rate-limits
 *
 * NOTE: Author/composer/producer credits are not available via the public API.
 * Those fields are always returned as empty arrays for manual fill-in.
 *
 * @param {string} token - Spotify access token
 * @param {string} albumId - Spotify album ID
 * @returns {Promise<Track[]>}
 */
async function fetchAlbumTracks (token, albumId) {
  const tracks = []
  let url = `/v1/albums/${albumId}/tracks?limit=50`

  while (url) {
    await delay(DELAY_MS)
    const { statusCode, body } = await spotifyGetWithRetry(token, url)
    if (statusCode !== 200 || !body) break

    for (const item of (body.items || [])) {
      tracks.push({
        trackNumber: item.track_number,
        title: item.name,
        isrc: (item.external_ids && item.external_ids.isrc) || null,
        authors: [],
        composers: [],
        producers: []
      })
    }

    if (body.next) {
      try {
        const parsed = new URL(body.next)
        url = parsed.pathname + parsed.search
      } catch {
        url = null
      }
    } else {
      url = null
    }
  }

  return tracks
}

module.exports = { fetchAlbumTracks }
