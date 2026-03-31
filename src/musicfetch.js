'use strict'

const https = require('https')
const querystring = require('querystring')

const RAPIDAPI_HOST = 'musicfetch2.p.rapidapi.com'
const DELAY_MS = 500

const SERVICES = 'spotify,appleMusic,deezer,amazonMusic,youtubeMusic,bandcamp,beatport,soundcloud,tidal'

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Looks up streaming links for a given platform URL via MusicFetch (RapidAPI).
 * Supported sources: spotify, appleMusic, deezer, tidal, amazon, soundcloud, etc.
 * Bandcamp URLs are NOT supported as a source.
 *
 * @param {string} apiKey - X-RapidAPI-Key
 * @param {string} url - Source platform URL (must be a supported platform)
 * @param {string} [country] - ISO country code (default: US)
 * @returns {Promise<object|null>} Flat map of platform → URL, or null
 */
async function fetchLinksByUrl (apiKey, url, country = 'US') {
  const qs = querystring.stringify({ url, services: SERVICES, country })

  return new Promise((resolve) => {
    const options = {
      hostname: RAPIDAPI_HOST,
      path: `/url?${qs}`,
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': RAPIDAPI_HOST
      }
    }

    https.get(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null)
        if (res.statusCode === 429) {
          console.warn('  [musicfetch] Rate limited (429)')
          return resolve(null)
        }
        if (res.statusCode !== 200) {
          console.warn(`  [musicfetch] HTTP ${res.statusCode}: ${raw.slice(0, 200)}`)
          return resolve(null)
        }
        try {
          const data = JSON.parse(raw)
          resolve(extractLinks(data))
        } catch { resolve(null) }
      })
    }).on('error', () => resolve(null))
  })
}

/**
 * Looks up streaming links for an album by UPC via MusicFetch (RapidAPI).
 *
 * @param {string} apiKey
 * @param {string} upc
 * @param {string} [country]
 * @returns {Promise<object|null>}
 */
async function fetchLinksByUpc (apiKey, upc, country = 'US') {
  const qs = querystring.stringify({ upc, services: SERVICES, withTracks: 'false', country })

  return new Promise((resolve) => {
    const options = {
      hostname: RAPIDAPI_HOST,
      path: `/upc?${qs}`,
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': RAPIDAPI_HOST,
        'Content-Type': 'application/json'
      }
    }

    https.get(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null)
        if (res.statusCode === 429) {
          console.warn('  [musicfetch] Rate limited (429)')
          return resolve(null)
        }
        if (res.statusCode !== 200) {
          console.warn(`  [musicfetch] UPC HTTP ${res.statusCode}: ${raw.slice(0, 200)}`)
          return resolve(null)
        }
        try {
          const data = JSON.parse(raw)
          resolve(extractLinks(data))
        } catch { resolve(null) }
      })
    }).on('error', () => resolve(null))
  })
}

/**
 * Extracts a flat platform → URL map from a MusicFetch response.
 * Response shape: { result: { services: { spotify: { link: '...' }, appleMusic: { link: '...' }, ... } } }
 */
function extractLinks (data) {
  if (!data) return null

  // Unwrap result envelope if present
  const obj = data.result || data

  const services = obj.services
  if (!services || typeof services !== 'object') return null

  const platformMap = {
    spotify: 'spotify',
    appleMusic: 'appleMusic',
    deezer: 'deezer',
    tidal: 'tidal',
    amazonMusic: 'amazonMusic',
    amazon: 'amazonMusic',
    youtubeMusic: 'youtubeMusic',
    soundcloud: 'soundcloud',
    beatport: 'beatport',
    bandcamp: 'bandcamp',
  }

  const links = {}
  for (const [serviceKey, ourKey] of Object.entries(platformMap)) {
    const entry = services[serviceKey]
    if (entry) {
      const url = entry.link || entry.url || (typeof entry === 'string' ? entry : null)
      if (url && url.startsWith('http')) {
        links[ourKey] = url
      }
    }
  }

  return Object.keys(links).length > 0 ? links : null
}

/**
 * Enriches an array of albums with streaming links via MusicFetch.
 * Uses the Bandcamp URL as the source. Falls back to Spotify URL if available.
 * Mutates each album in place.
 *
 * @param {Array} albums
 * @param {string} artistName - for logging
 * @param {string} apiKey
 */
async function enrichAlbumsWithMusicFetch (albums, artistName, apiKey) {
  for (const album of albums) {
    // Prefer UPC lookup (most reliable), fall back to Spotify URL
    const upc = album.upc
    const spotifyUrl = album.streamingLinks && album.streamingLinks.spotify
    if (!upc && !spotifyUrl) continue

    try {
      await delay(DELAY_MS)
      const links = upc
        ? await fetchLinksByUpc(apiKey, upc)
        : await fetchLinksByUrl(apiKey, spotifyUrl)

      if (links) {
        const existing = album.streamingLinks || {}
        album.streamingLinks = { ...links, ...existing }
        const method = upc ? `UPC ${upc}` : 'Spotify URL'
        console.log(`    ✓ MusicFetch (${method}): "${album.title}" → ${Object.keys(links).join(', ')}`)
      }
    } catch (err) {
      console.warn(`    ⚠ MusicFetch failed for "${album.title}": ${err.message}`)
    }
  }
}

/**
 * Enriches an artist with streaming links via MusicFetch.
 * Mutates in place.
 *
 * @param {object} artist
 * @param {string} apiKey
 */
async function enrichArtistWithMusicFetch (artist, apiKey) {
  // Use Spotify artist URL as source — Bandcamp URLs not supported by MusicFetch
  const sourceUrl = artist.streamingLinks && artist.streamingLinks.spotify
  if (!sourceUrl) return

  try {
    await delay(DELAY_MS)
    const links = await fetchLinksByUrl(apiKey, sourceUrl)
    if (links) {
      const existing = artist.streamingLinks || {}
      artist.streamingLinks = { ...links, ...existing }
      console.log(`  ✓ MusicFetch artist: "${artist.name}" → ${Object.keys(links).join(', ')}`)
    }
  } catch { /* ignore */ }
}

module.exports = { enrichAlbumsWithMusicFetch, enrichArtistWithMusicFetch, fetchLinksByUrl, fetchLinksByUpc }
