'use strict'

const https = require('https')

const BASE_HOST = 'customer.api.soundcharts.com'
const DELAY_MS = 150

// --- Internal state ---
let _lastQuotaRemaining = null
let _callCount = 0
let _lastRequestTime = 0

/**
 * Platform code mapping: Soundcharts platformCode → cache key.
 */
const PLATFORM_MAP = {
  // Streaming platforms
  spotify: 'spotify',
  'apple-music': 'appleMusic',
  deezer: 'deezer',
  tidal: 'tidal',
  amazon: 'amazonMusic',
  youtube: 'youtube',
  soundcloud: 'soundcloud',
  // Social media platforms
  facebook: 'facebook',
  instagram: 'instagram',
  tiktok: 'tiktok',
  twitter: 'twitter',
  linktree: 'linktree',
  // Discovery platforms
  genius: 'genius',
  lastfm: 'lastfm',
  musicbrainz: 'musicbrainz',
  // Event platforms
  bandsintown: 'bandsintown',
  songkick: 'songkick'
}

const STREAMING_PLATFORMS = new Set(['spotify', 'appleMusic', 'deezer', 'tidal', 'amazonMusic', 'youtube', 'soundcloud'])
const SOCIAL_PLATFORMS = new Set(['facebook', 'instagram', 'tiktok', 'twitter', 'linktree'])
const DISCOVERY_PLATFORMS = new Set(['genius', 'lastfm', 'musicbrainz'])
const EVENT_PLATFORMS = new Set(['bandsintown', 'songkick'])

/**
 * Splits mapped identifier links into categorized groups.
 * @param {Object} allLinks - Output of mapIdentifiersToLinks (key → url)
 * @returns {{ streamingLinks: Object, socialLinks: Object, discoveryLinks: Object, eventLinks: Object }}
 */
function categorizeLinks (allLinks) {
  const result = { streamingLinks: {}, socialLinks: {}, discoveryLinks: {}, eventLinks: {} }
  for (const [key, url] of Object.entries(allLinks || {})) {
    if (STREAMING_PLATFORMS.has(key)) result.streamingLinks[key] = url
    else if (SOCIAL_PLATFORMS.has(key)) result.socialLinks[key] = url
    else if (DISCOVERY_PLATFORMS.has(key)) result.discoveryLinks[key] = url
    else if (EVENT_PLATFORMS.has(key)) result.eventLinks[key] = url
  }
  return result
}

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Enforces minimum inter-request delay of 150ms.
 */
async function throttle () {
  const now = Date.now()
  const elapsed = now - _lastRequestTime
  if (_lastRequestTime && elapsed < DELAY_MS) {
    await delay(DELAY_MS - elapsed)
  }
  _lastRequestTime = Date.now()
}

/**
 * Makes an authenticated GET request to the Soundcharts API.
 * Enforces 150ms minimum delay between requests.
 * @param {string} path - API path (e.g. /api/v2.9/artist/...)
 * @param {string} appId - x-app-id header value
 * @param {string} apiKey - x-api-key header value
 * @returns {Promise<{statusCode: number, body: Object|null, quotaRemaining: number|null}>}
 */
async function scGet (path, appId, apiKey) {
  await throttle()
  _callCount++

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
        const quotaRaw = res.headers['x-quota-remaining']
        const quotaRemaining = quotaRaw != null ? Number(quotaRaw) : null
        if (quotaRemaining != null) {
          _lastQuotaRemaining = quotaRemaining
        }
        try {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(raw),
            quotaRemaining
          })
        } catch {
          resolve({ statusCode: res.statusCode, body: null, quotaRemaining })
        }
      })
    }).on('error', () => {
      resolve({ statusCode: 0, body: null, quotaRemaining: null })
    })
  })
}

/**
 * Wraps scGet with exponential backoff retry on HTTP 429.
 * Backoff: 5s × 2^attempt, capped at 30s, max 3 retries.
 * @param {string} path - API path
 * @param {string} appId - x-app-id header value
 * @param {string} apiKey - x-api-key header value
 * @param {number} [maxRetries=3] - Maximum retry attempts
 * @returns {Promise<{statusCode: number, body: Object|null, quotaRemaining: number|null}>}
 */
async function scGetWithRetry (path, appId, apiKey, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await scGet(path, appId, apiKey)
    if (result.statusCode !== 429) return result

    if (attempt < maxRetries) {
      const backoff = Math.min(5 * Math.pow(2, attempt), 30)
      console.warn(`[warn] Soundcharts rate limited — waiting ${backoff}s (attempt ${attempt + 1}/${maxRetries})`)
      await delay(backoff * 1000)
    }
  }
  console.warn('[warn] Soundcharts: max retries exceeded, skipping')
  return { statusCode: 429, body: null, quotaRemaining: null }
}

// ---------------------------------------------------------------------------
// Quota & call tracking (Task 1.3)
// ---------------------------------------------------------------------------

/**
 * Returns the latest x-quota-remaining value from the most recent API response.
 * @returns {number|null}
 */
function getQuotaRemaining () {
  return _lastQuotaRemaining
}

/**
 * Returns the total number of API calls made since last reset.
 * @returns {number}
 */
function getCallCount () {
  return _callCount
}

/**
 * Resets the call counter to zero.
 */
function resetCallCount () {
  _callCount = 0
}

// ---------------------------------------------------------------------------
// Identifier mapping helper
// ---------------------------------------------------------------------------

/**
 * Maps a Soundcharts identifiers array to a streaming links object.
 * Only includes platforms present in PLATFORM_MAP; unknown platforms are ignored.
 * @param {Array<{platformCode: string, url: string}>} identifiers
 * @returns {Object} e.g. { spotify: '...', appleMusic: '...', deezer: '...' }
 */
function mapIdentifiersToLinks (identifiers) {
  const links = {}
  if (!Array.isArray(identifiers)) return links
  for (const item of identifiers) {
    const cacheKey = PLATFORM_MAP[item.platformCode]
    if (cacheKey && item.url) {
      links[cacheKey] = item.url
    }
  }
  return links
}

// ---------------------------------------------------------------------------
// Album metadata normalizer
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw Soundcharts album object to the cache-friendly shape.
 * @param {Object} raw - The raw `body.object` from a Soundcharts album endpoint
 * @returns {Object} Normalized album metadata
 */
function normalizeAlbumMeta (raw) {
  if (!raw) return null
  return {
    uuid: raw.uuid || null,
    name: raw.name || null,
    upc: raw.upc || null,
    labels: Array.isArray(raw.labels)
      ? raw.labels.map(l => ({ name: l.name || null, type: l.type || null }))
      : [],
    distributor: (raw.distributor && raw.distributor.name) || (typeof raw.distributor === 'string' ? raw.distributor : null),
    copyright: raw.copyright || null,
    totalTracks: raw.totalTracks || null,
    releaseDate: raw.releaseDate || null,
    type: raw.type || null
  }
}

// ---------------------------------------------------------------------------
// Public API functions (Tasks 1.4 – 1.8)
// ---------------------------------------------------------------------------

/**
 * Resolves a Spotify artist ID to a Soundcharts artist object.
 * @param {string} spotifyId - Spotify artist ID (e.g. '4Z8W4fKeB5YxbusRsdQVPb')
 * @param {string} appId - x-app-id
 * @param {string} apiKey - x-api-key
 * @returns {Promise<{uuid: string, name: string, slug: string}|null>}
 */
async function getArtistBySpotifyId (spotifyId, appId, apiKey) {
  const { statusCode, body } = await scGetWithRetry(
    `/api/v2.9/artist/by-platform/spotify/${spotifyId}`,
    appId, apiKey
  )
  if (statusCode !== 200 || !body || !body.object) return null
  return {
    uuid: body.object.uuid,
    name: body.object.name,
    slug: body.object.slug
  }
}

/**
 * Fetches all platform identifiers for an artist and maps them to cache keys.
 * @param {string} artistUuid - Soundcharts artist UUID
 * @param {string} appId - x-app-id
 * @param {string} apiKey - x-api-key
 * @returns {Promise<Object|null>} e.g. { spotify: '...', appleMusic: '...', ... }
 */
async function getArtistIdentifiers (artistUuid, appId, apiKey) {
  const { statusCode, body } = await scGetWithRetry(
    `/api/v2/artist/${artistUuid}/identifiers?onlyDefault=true`,
    appId, apiKey
  )
  if (statusCode !== 200 || !body || !body.items) return null
  return mapIdentifiersToLinks(body.items)
}

/**
 * Gets album metadata by Spotify album ID.
 * @param {string} spotifyAlbumId - Spotify album ID
 * @param {string} appId - x-app-id
 * @param {string} apiKey - x-api-key
 * @returns {Promise<Object|null>} Normalized album metadata or null
 */
async function getAlbumBySpotifyId (spotifyAlbumId, appId, apiKey) {
  const { statusCode, body } = await scGetWithRetry(
    `/api/v2.36/album/by-platform/spotify/${spotifyAlbumId}`,
    appId, apiKey
  )
  if (statusCode !== 200 || !body || !body.object) return null
  return normalizeAlbumMeta(body.object)
}

/**
 * Gets album metadata by UPC.
 * @param {string} upc - Universal Product Code
 * @param {string} appId - x-app-id
 * @param {string} apiKey - x-api-key
 * @returns {Promise<Object|null>} Normalized album metadata or null
 */
async function getAlbumByUpc (upc, appId, apiKey) {
  const { statusCode, body } = await scGetWithRetry(
    `/api/v2.36/album/by-upc/${upc}`,
    appId, apiKey
  )
  if (statusCode !== 200 || !body || !body.object) return null
  return normalizeAlbumMeta(body.object)
}

/**
 * Fetches all platform identifiers for an album and maps them to cache keys.
 * @param {string} albumUuid - Soundcharts album UUID
 * @param {string} appId - x-app-id
 * @param {string} apiKey - x-api-key
 * @returns {Promise<Object|null>} e.g. { spotify: '...', appleMusic: '...', ... }
 */
async function getAlbumIdentifiers (albumUuid, appId, apiKey) {
  const { statusCode, body } = await scGetWithRetry(
    `/api/v2.26/album/${albumUuid}/identifiers?onlyDefault=true`,
    appId, apiKey
  )
  if (statusCode !== 200 || !body || !body.items) return null
  return mapIdentifiersToLinks(body.items)
}

// ---------------------------------------------------------------------------
// Events endpoint (Task 10)
// ---------------------------------------------------------------------------

/**
 * Fetches upcoming events for an artist from Soundcharts.
 * @param {string} artistUuid - Soundcharts artist UUID
 * @param {string} appId - x-app-id
 * @param {string} apiKey - x-api-key
 * @param {string} startDate - ISO date string (YYYY-MM-DD) for filtering future events
 * @returns {Promise<Array<{date, name, type, venueName, cityName, countryCode, countryName}>>}
 */
async function getArtistEvents (artistUuid, appId, apiKey, startDate) {
  const { statusCode, body } = await scGetWithRetry(
    `/api/v2/artist/${artistUuid}/events?type=all&startDate=${startDate}&limit=50&sortBy=date&sortOrder=asc`,
    appId, apiKey
  )
  if (statusCode !== 200 || !body || !body.items) return []
  return body.items.map(e => ({
    date: e.date || e.startedAt || null,
    name: e.name || null,
    type: e.type || 'concert',
    venueName: (e.venue && e.venue.name) || null,
    cityName: (e.venue && e.venue.cityName) || null,
    countryCode: (e.venue && e.venue.countryCode) || null,
    countryName: (e.venue && e.venue.countryName) || null
  }))
}

// ---------------------------------------------------------------------------
// Artist albums endpoint
// ---------------------------------------------------------------------------

/**
 * Fetches all albums for an artist from Soundcharts (paginated).
 * @param {string} artistUuid - Soundcharts artist UUID
 * @param {string} appId - x-app-id
 * @param {string} apiKey - x-api-key
 * @param {string} [type='all'] - 'all', 'album', 'single', 'compil'
 * @returns {Promise<Array<{uuid, name, type, releaseDate, creditName}>>}
 */
async function getArtistAlbums (artistUuid, appId, apiKey, type = 'all') {
  const albums = []
  let offset = 0
  const limit = 100

  while (true) {
    const { statusCode, body } = await scGetWithRetry(
      `/api/v2.34/artist/${artistUuid}/albums?type=${type}&sortBy=releaseDate&sortOrder=desc&offset=${offset}&limit=${limit}`,
      appId, apiKey
    )
    if (statusCode !== 200 || !body || !body.items) break

    albums.push(...body.items.map(a => ({
      uuid: a.uuid,
      name: a.name,
      type: a.type || null,
      releaseDate: a.releaseDate || null,
      creditName: a.creditName || null
    })))

    if (!body.page || !body.page.next) break
    offset += limit
  }

  return albums
}

// ---------------------------------------------------------------------------
// Exports (Task 1.9)
// ---------------------------------------------------------------------------

module.exports = {
  PLATFORM_MAP,
  STREAMING_PLATFORMS,
  SOCIAL_PLATFORMS,
  DISCOVERY_PLATFORMS,
  EVENT_PLATFORMS,
  getQuotaRemaining,
  getCallCount,
  resetCallCount,
  getArtistBySpotifyId,
  getArtistIdentifiers,
  getArtistAlbums,
  getAlbumBySpotifyId,
  getAlbumByUpc,
  getAlbumIdentifiers,
  getArtistEvents,
  // Exported for testing
  mapIdentifiersToLinks,
  normalizeAlbumMeta,
  categorizeLinks
}
