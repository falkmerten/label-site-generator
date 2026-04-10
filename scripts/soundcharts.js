'use strict'

const https = require('https')

const BASE_HOST = 'customer.api.soundcharts.com'
const DELAY_MS = 150 // stay well under 10k calls/min

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Makes an authenticated GET request to the Soundcharts API.
 * @param {string} path - API path
 * @param {string} appId - x-app-id header
 * @param {string} apiKey - x-api-key header
 * @returns {Promise<{statusCode: number, body: Object|null, quotaRemaining: string|null}>}
 */
function scGet (path, appId, apiKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: BASE_HOST,
      path,
      method: 'GET',
      headers: {
        'x-app-id': appId,
        'x-api-key': apiKey
      }
    }
    https.get(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(raw),
            quotaRemaining: res.headers['x-quota-remaining'] || null
          })
        } catch {
          resolve({ statusCode: res.statusCode, body: null, quotaRemaining: null })
        }
      })
    }).on('error', () => resolve({ statusCode: 0, body: null, quotaRemaining: null }))
  })
}

/**
 * Wraps scGet with retry on 429 (rate limit).
 */
async function scGetWithRetry (path, appId, apiKey, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await scGet(path, appId, apiKey)
    if (result.statusCode !== 429) return result

    const backoff = Math.min(5 * Math.pow(2, attempt), 30)
    console.warn(`[warn] Soundcharts rate limited — waiting ${backoff}s (attempt ${attempt + 1}/${maxRetries})`)
    await delay(backoff * 1000)
  }
  console.warn('[warn] Soundcharts: max retries exceeded, skipping')
  return { statusCode: 429, body: null, quotaRemaining: null }
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

/**
 * Resolves a Spotify artist ID to a Soundcharts artist UUID.
 * @param {string} spotifyId - Spotify artist ID
 * @param {string} appId
 * @param {string} apiKey
 * @returns {Promise<{uuid: string, name: string}|null>}
 */
async function getArtistBySpotifyId (spotifyId, appId, apiKey) {
  await delay(DELAY_MS)
  const { statusCode, body } = await scGetWithRetry(
    `/api/v2.9/artist/by-platform/spotify/${spotifyId}`,
    appId, apiKey
  )
  if (statusCode !== 200 || !body || !body.object) return null
  return { uuid: body.object.uuid, name: body.object.name, slug: body.object.slug }
}

/**
 * Fetches all albums for an artist (paginated).
 * @param {string} artistUuid
 * @param {string} appId
 * @param {string} apiKey
 * @param {string} [type='all'] - 'all', 'album', 'single', 'compil'
 * @returns {Promise<Array>}
 */
async function getArtistAlbums (artistUuid, appId, apiKey, type = 'all') {
  const albums = []
  let offset = 0
  const limit = 100

  while (true) {
    await delay(DELAY_MS)
    const { statusCode, body } = await scGetWithRetry(
      `/api/v2.34/artist/${artistUuid}/albums?type=${type}&sortBy=releaseDate&sortOrder=desc&offset=${offset}&limit=${limit}`,
      appId, apiKey
    )
    if (statusCode !== 200 || !body || !body.items) break

    albums.push(...body.items)

    if (!body.page || !body.page.next) break
    offset += limit
  }

  return albums
}

/**
 * Gets album metadata by Spotify album ID.
 * @param {string} spotifyAlbumId
 * @param {string} appId
 * @param {string} apiKey
 * @returns {Promise<Object|null>}
 */
async function getAlbumBySpotifyId (spotifyAlbumId, appId, apiKey) {
  await delay(DELAY_MS)
  const { statusCode, body } = await scGetWithRetry(
    `/api/v2.36/album/by-platform/spotify/${spotifyAlbumId}`,
    appId, apiKey
  )
  if (statusCode !== 200 || !body || !body.object) return null
  return body.object
}

/**
 * Gets album metadata by UPC.
 * @param {string} upc
 * @param {string} appId
 * @param {string} apiKey
 * @returns {Promise<Object|null>}
 */
async function getAlbumByUpc (upc, appId, apiKey) {
  await delay(DELAY_MS)
  const { statusCode, body } = await scGetWithRetry(
    `/api/v2.36/album/by-upc/${upc}`,
    appId, apiKey
  )
  if (statusCode !== 200 || !body || !body.object) return null
  return body.object
}

/**
 * Gets tracklisting for an album.
 * @param {string} albumUuid
 * @param {string} appId
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
async function getAlbumTracks (albumUuid, appId, apiKey) {
  await delay(DELAY_MS)
  const { statusCode, body } = await scGetWithRetry(
    `/api/v2.26/album/${albumUuid}/tracks`,
    appId, apiKey
  )
  if (statusCode !== 200 || !body || !body.items) return []
  return body.items
}

/**
 * Gets song metadata by ISRC (includes composers, producers, labels, audio features).
 * @param {string} isrc
 * @param {string} appId
 * @param {string} apiKey
 * @returns {Promise<Object|null>}
 */
async function getSongByIsrc (isrc, appId, apiKey) {
  await delay(DELAY_MS)
  const { statusCode, body } = await scGetWithRetry(
    `/api/v2.25/song/by-isrc/${isrc}`,
    appId, apiKey
  )
  if (statusCode !== 200 || !body || !body.object) return null
  return body.object
}

/**
 * Gets song metadata by Soundcharts UUID.
 * @param {string} songUuid
 * @param {string} appId
 * @param {string} apiKey
 * @returns {Promise<Object|null>}
 */
async function getSongMetadata (songUuid, appId, apiKey) {
  await delay(DELAY_MS)
  const { statusCode, body } = await scGetWithRetry(
    `/api/v2.25/song/${songUuid}`,
    appId, apiKey
  )
  if (statusCode !== 200 || !body || !body.object) return null
  return body.object
}

/**
 * Gets work metadata by ISWC (includes writers with roles and publishers with shares).
 * @param {string} iswc
 * @param {string} appId
 * @param {string} apiKey
 * @returns {Promise<Object|null>}
 */
async function getWorkByIswc (iswc, appId, apiKey) {
  await delay(DELAY_MS)
  const { statusCode, body } = await scGetWithRetry(
    `/api/v2/work/by-iswc/${iswc}`,
    appId, apiKey
  )
  if (statusCode !== 200 || !body || !body.object) return null
  return body.object
}

module.exports = {
  getArtistBySpotifyId,
  getArtistAlbums,
  getAlbumBySpotifyId,
  getAlbumByUpc,
  getAlbumTracks,
  getSongByIsrc,
  getSongMetadata,
  getWorkByIswc
}
