'use strict'

const https = require('https')

// Rate limiting: 10 req/min = 6s minimum, add 500ms safety margin
const MIN_DELAY_MS = 6500
const DEFAULT_RETRY_WAIT_MS = 600000 // 10 minutes (real-world observation)

let lastCallTime = 0

// Target platforms to extract from Odesli response
const TARGET_PLATFORMS = ['youtubeMusic', 'amazonMusic', 'soundcloud', 'pandora', 'napster']

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Enforces minimum delay between consecutive calls.
 */
async function enforceRateLimit () {
  const now = Date.now()
  const elapsed = now - lastCallTime
  if (lastCallTime > 0 && elapsed < MIN_DELAY_MS) {
    await delay(MIN_DELAY_MS - elapsed)
  }
  lastCallTime = Date.now()
}

/**
 * Makes an HTTPS GET request and returns { statusCode, headers, body }.
 */
function httpsGet (url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: raw })
      })
    }).on('error', (err) => {
      resolve({ statusCode: 0, headers: {}, body: '', error: err })
    })
  })
}

/**
 * Extracts target platform URLs from an Odesli linksByPlatform response.
 * Returns object with only populated platform keys.
 */
function extractPlatformLinks (linksByPlatform) {
  if (!linksByPlatform || typeof linksByPlatform !== 'object') return {}
  const result = {}
  for (const platform of TARGET_PLATFORMS) {
    if (linksByPlatform[platform] && linksByPlatform[platform].url) {
      result[platform] = linksByPlatform[platform].url
    }
  }
  return result
}

/**
 * Looks up streaming platform links for a Spotify album URL via Odesli/Songlink API.
 *
 * @param {string} spotifyUrl - Spotify album URL (e.g. "https://open.spotify.com/album/...")
 * @returns {Promise<object>} Object with platform keys: { youtubeMusic, amazonMusic, soundcloud, pandora, napster }
 *                            Only populated keys are included. Returns {} on failure/not-found.
 */
async function lookupBySpotifyUrl (spotifyUrl) {
  if (!spotifyUrl) return {}

  await enforceRateLimit()

  const encodedUrl = encodeURIComponent(spotifyUrl)
  const apiUrl = `https://api.song.link/v1-alpha.1/links?url=${encodedUrl}`

  const res = await httpsGet(apiUrl)

  // Network error
  if (res.error) {
    console.warn(`    ⚠ Songlink network error: ${res.error.message}`)
    return {}
  }

  // 429 — rate limited, retry once
  if (res.statusCode === 429) {
    const retryAfter = parseInt(res.headers['retry-after'], 10) || (DEFAULT_RETRY_WAIT_MS / 1000)
    const waitMs = retryAfter * 1000
    console.warn(`    ⚠ Songlink 429 — waiting ${retryAfter}s before retry...`)
    await delay(waitMs)

    lastCallTime = Date.now()
    const retryRes = await httpsGet(apiUrl)

    if (retryRes.statusCode === 429) {
      console.warn('    ⚠ Songlink 429 on retry — skipping')
      return {}
    }
    if (retryRes.statusCode === 404 || retryRes.statusCode !== 200) return {}

    try {
      const data = JSON.parse(retryRes.body)
      return extractPlatformLinks(data.linksByPlatform)
    } catch {
      console.warn('    ⚠ Songlink: malformed JSON on retry')
      return {}
    }
  }

  // 404 or other non-200
  if (res.statusCode === 404 || res.statusCode !== 200) return {}

  // Parse response
  try {
    const data = JSON.parse(res.body)
    return extractPlatformLinks(data.linksByPlatform)
  } catch {
    console.warn('    ⚠ Songlink: malformed JSON response')
    return {}
  }
}

module.exports = { lookupBySpotifyUrl }
