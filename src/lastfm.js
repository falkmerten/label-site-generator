'use strict'

const https = require('https')

const DELAY_MS = 300 // Last.fm allows 5 req/sec, we use ~3 req/sec
const API_BASE = 'https://ws.audioscrobbler.com/2.0/'

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Makes an HTTPS GET request and returns parsed JSON.
 */
function fetchJson (url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null)
        try { resolve(JSON.parse(raw)) } catch { resolve(null) }
      })
    }).on('error', () => resolve(null))
  })
}

/**
 * Strips HTML tags from a string.
 */
function stripHtml (html) {
  return (html || '').replace(/<[^>]+>/g, '')
}

/**
 * Cleans Last.fm bio text — removes "Read more on Last.fm" suffix and trailing URLs.
 */
function cleanBio (text) {
  if (!text) return ''
  text = stripHtml(text)
  text = text.replace(/\s*Read more on Last\.fm\.?\s*$/i, '')
  text = text.replace(/\s*https?:\/\/www\.last\.fm\/music\/[^\s]*\s*$/i, '')
  text = text.replace(/\s*User-contributed text is available under.*$/i, '')
  return text.trim()
}

/**
 * Fetches artist info from Last.fm API.
 * Returns { bio, listeners, playcount, tags, similar, url } or null.
 *
 * @param {string} apiKey - Last.fm API key
 * @param {string} artistName - Artist name to look up
 * @returns {Promise<object|null>}
 */
async function getArtistInfo (apiKey, artistName) {
  if (!apiKey || !artistName) return null
  await delay(DELAY_MS)

  const url = `${API_BASE}?method=artist.getinfo&artist=${encodeURIComponent(artistName)}&api_key=${apiKey}&format=json`
  const data = await fetchJson(url)

  if (!data || data.error || !data.artist) return null

  const artist = data.artist
  const bio = cleanBio(artist.bio && artist.bio.summary)
  const listeners = parseInt(artist.stats && artist.stats.listeners, 10) || 0
  const playcount = parseInt(artist.stats && artist.stats.playcount, 10) || 0

  const tags = []
  if (artist.tags && artist.tags.tag && Array.isArray(artist.tags.tag)) {
    for (const t of artist.tags.tag) {
      if (t.name) tags.push(t.name)
    }
  }

  const similar = []
  if (artist.similar && artist.similar.artist && Array.isArray(artist.similar.artist)) {
    for (const s of artist.similar.artist) {
      if (s.name) similar.push(s.name)
    }
  }

  return {
    bio: bio.length > 50 ? bio : null,
    listeners,
    playcount,
    tags: tags.slice(0, 10),
    similar: similar.slice(0, 5),
    url: artist.url || null
  }
}

/**
 * Fetches similar artists from Last.fm.
 * @param {string} apiKey
 * @param {string} artistName
 * @returns {Promise<Array<{name: string, match: number}>>}
 */
async function getSimilarArtists (apiKey, artistName) {
  if (!apiKey || !artistName) return []
  await delay(DELAY_MS)

  const url = `${API_BASE}?method=artist.getsimilar&artist=${encodeURIComponent(artistName)}&api_key=${apiKey}&limit=10&format=json`
  const data = await fetchJson(url)

  if (!data || !data.similarartists || !data.similarartists.artist) return []

  return data.similarartists.artist
    .filter(a => a.name)
    .slice(0, 10)
    .map(a => ({ name: a.name, match: parseFloat(a.match) || 0 }))
}

/**
 * Enriches an artist with Last.fm metadata.
 * Writes to artist.lastfm object (bio, listeners, playcount, tags, similar, url).
 * Does NOT overwrite existing data.
 *
 * @param {object} artist - Artist object from cache (mutated in place)
 * @param {string} apiKey - Last.fm API key
 * @param {object} [options] - { rosterNames: string[] } for disambiguation
 * @returns {Promise<boolean>} true if data was added
 */
async function enrichArtistWithLastfm (artist, apiKey, options = {}) {
  if (!apiKey || !artist || !artist.name) return false

  // Skip if already enriched
  if (artist.lastfm && artist.lastfm.listeners) return false

  const info = await getArtistInfo(apiKey, artist.name)
  if (!info) return false

  // Disambiguation: compare Last.fm tags against existing album tags
  // If no genre overlap at all, it's likely a different artist with the same name
  if (info.tags.length > 0 && artist.albums && artist.albums.length > 0) {
    const albumTags = new Set()
    for (const al of artist.albums) {
      for (const t of al.tags || []) {
        const tagName = typeof t === 'string' ? t : (t.name || '')
        if (tagName) albumTags.add(tagName.toLowerCase())
      }
    }

    if (albumTags.size > 0) {
      const lastfmTagsLower = info.tags.map(t => t.toLowerCase())
      const overlap = lastfmTagsLower.filter(t => albumTags.has(t)).length
      const overlapRatio = overlap / Math.max(lastfmTagsLower.length, 1)

      if (overlapRatio === 0 && info.listeners > 100000) {
        // Zero overlap + high listener count = likely wrong artist (major label act with same name)
        console.log(`    ⚠ Last.fm: disambiguation failed for "${artist.name}" (0 tag overlap, ${info.listeners} listeners) — skipping`)
        artist.lastfm = { skipped: true, reason: 'disambiguation' }
        return false
      }
    }
  }

  artist.lastfm = {
    bio: info.bio,
    listeners: info.listeners,
    playcount: info.playcount,
    tags: info.tags,
    similar: info.similar,
    url: info.url,
    fetchedAt: new Date().toISOString()
  }

  const parts = []
  if (info.bio) parts.push('bio')
  if (info.listeners) parts.push(`${info.listeners.toLocaleString()} listeners`)
  if (info.tags.length) parts.push(`${info.tags.length} tags`)
  if (info.similar.length) parts.push(`${info.similar.length} similar`)
  console.log(`  ✓ Last.fm: ${parts.join(', ')}`)

  return true
}

module.exports = { getArtistInfo, getSimilarArtists, enrichArtistWithLastfm, cleanBio, stripHtml }
