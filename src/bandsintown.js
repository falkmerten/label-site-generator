'use strict'

const https = require('https')

const BASE_HOST = 'rest.bandsintown.com'
const TIMEOUT_MS = 10000

/**
 * Makes a GET request to the Bandsintown API with a 10s timeout.
 * @param {string} path - API path (e.g. /artists/Fernando%27s%20Eyes?app_id=...)
 * @returns {Promise<{statusCode: number, body: Object|Array|null}>}
 */
function bitGet (path) {
  return new Promise((resolve) => {
    const options = {
      hostname: BASE_HOST,
      path,
      method: 'GET',
      headers: { Accept: 'application/json' }
    }

    const req = https.get(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(raw) })
        } catch {
          resolve({ statusCode: res.statusCode, body: null })
        }
      })
    })

    req.on('error', (err) => {
      console.warn(`[bandsintown] Network error: ${err.message}`)
      resolve({ statusCode: 0, body: null })
    })

    req.on('timeout', () => {
      console.warn('[bandsintown] Request timed out')
      req.destroy()
      resolve({ statusCode: 0, body: null })
    })

    req.setTimeout(TIMEOUT_MS)
  })
}

/**
 * Fetches artist info from Bandsintown.
 * @param {string} artistName - Artist name (will be URL-encoded)
 * @param {string} appId - Bandsintown app_id
 * @returns {Promise<{trackerCount: number, upcomingEventCount: number}|null>}
 */
async function fetchArtistInfo (artistName, appId) {
  const encoded = encodeURIComponent(artistName)
  const { statusCode, body } = await bitGet(`/artists/${encoded}?app_id=${encodeURIComponent(appId)}`)

  if (statusCode !== 200 || !body || typeof body !== 'object') {
    if (statusCode > 0) {
      console.warn(`[bandsintown] Artist info failed for "${artistName}" (HTTP ${statusCode})`)
    }
    return null
  }

  return {
    trackerCount: typeof body.tracker_count === 'number' ? body.tracker_count : 0,
    upcomingEventCount: typeof body.upcoming_event_count === 'number' ? body.upcoming_event_count : 0
  }
}

/**
 * Fetches upcoming events from Bandsintown.
 * @param {string} artistName - Artist name (will be URL-encoded)
 * @param {string} appId - Bandsintown app_id
 * @returns {Promise<Array>}
 */
async function fetchArtistEvents (artistName, appId) {
  const encoded = encodeURIComponent(artistName)
  const { statusCode, body } = await bitGet(`/artists/${encoded}/events?app_id=${encodeURIComponent(appId)}`)

  if (statusCode !== 200 || !Array.isArray(body)) {
    if (statusCode > 0) {
      console.warn(`[bandsintown] Events fetch failed for "${artistName}" (HTTP ${statusCode})`)
    }
    return []
  }

  return body.map(transformEvent)
}

/**
 * Transforms a raw Bandsintown API event into the generator's internal event format.
 * @param {object} raw - Raw API response event object
 * @returns {object} Internal event format
 */
function transformEvent (raw) {
  const datetime = raw.datetime || raw.starts_at || ''
  const date = datetime.slice(0, 10) // YYYY-MM-DD

  const venue = raw.venue || {}
  const offers = Array.isArray(raw.offers)
    ? raw.offers.map(o => ({
        type: o.type || 'Tickets',
        url: o.url || null,
        status: o.status || 'unknown'
      }))
    : []

  return {
    date: date || null,
    name: raw.festival_datetime ? (raw.title || raw.description || null) : null,
    type: raw.festival_datetime ? 'festival' : null,
    venueName: venue.name || null,
    cityName: venue.city || null,
    countryCode: venue.country || null,
    countryName: venue.region || venue.country || null,
    eventUrl: raw.url || null,
    offers,
    source: 'bandsintown'
  }
}

/**
 * Fetches Bandsintown data for all configured artists and attaches it to mergedData.
 * Iterates artists in content that have a bandsintown config, fetches info + events,
 * merges events with existing data, and attaches bandsintown metadata.
 *
 * @param {object} mergedData - The merged site data (mutated in place)
 * @param {object} content - ContentStore from content.js
 */
async function fetchAllArtists (mergedData, content) {
  const { mergeBandsintownEvents } = require('./merger')

  const artists = mergedData.artists || []
  for (const artist of artists) {
    const slug = artist.slug
    const artistContent = content.artists && content.artists[slug]
    if (!artistContent || !artistContent.bandsintown) continue

    const config = artistContent.bandsintown
    const appId = config.app_id
    const artistName = config.artist_name

    console.log(`[bandsintown] Fetching data for "${artistName}"...`)

    // Always set base bandsintown metadata from config so Follow CTA works
    artist.bandsintown = {
      appId,
      artistName
    }

    // Fetch artist info (non-fatal)
    try {
      const info = await fetchArtistInfo(artistName, appId)
      if (info) {
        artist.bandsintown.trackerCount = info.trackerCount
        artist.bandsintown.upcomingEventCount = info.upcomingEventCount
      }
    } catch (err) {
      console.warn(`[bandsintown] Artist info error for "${artistName}": ${err.message}`)
    }

    // Fetch events (non-fatal)
    try {
      const events = await fetchArtistEvents(artistName, appId)
      if (events.length > 0) {
        artist.events = mergeBandsintownEvents(artist.events || [], events)
        console.log(`[bandsintown] Merged ${events.length} event(s) for "${artistName}"`)
      }
    } catch (err) {
      console.warn(`[bandsintown] Events error for "${artistName}": ${err.message}`)
    }
  }
}

module.exports = { fetchArtistInfo, fetchArtistEvents, transformEvent, fetchAllArtists }
