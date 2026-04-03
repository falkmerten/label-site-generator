'use strict'

const https = require('https')
const fs = require('fs')
const path = require('path')
const { toSlug } = require('./slugs')

const DELAY_MS = 200

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function httpsGet (url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let raw = ''
      res.on('data', c => { raw += c })
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null)
        try { resolve(JSON.parse(raw)) } catch { resolve(null) }
      })
    }).on('error', () => resolve(null))
  })
}

/**
 * Searches YouTube for videos matching artist + album title.
 * Filters out "Topic" auto-generated channels and verifies results match the artist.
 * Returns array of { url, title } objects.
 *
 * @param {string} apiKey - YouTube Data API v3 key
 * @param {string} artistName - artist name for verification
 * @param {string} albumTitle - album/track title
 * @param {number} maxResults - max results to return (default 2)
 * @returns {Promise<Array<{url: string, title: string}>>}
 */
async function searchYouTube (apiKey, artistName, albumTitle, maxResults = 2) {
  const query = `${artistName} "${albumTitle}"`
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    videoCategoryId: '10', // Music category
    maxResults: String(maxResults + 5), // fetch extra to filter
    key: apiKey
  })
  const data = await httpsGet(`https://www.googleapis.com/youtube/v3/search?${params}`)
  if (!data || !data.items) return []

  const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const targetArtist = normalise(artistName)

  // Extract key words from album title for matching (strip parenthetical, feat., etc.)
  const titleCore = albumTitle
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s+(feat\.|ft\.|featuring)\s+.*/i, '')
    .trim()
  const titleWords = normalise(titleCore)

  return data.items
    .filter(item => {
      if (!item.id || !item.id.videoId) return false
      const snippet = item.snippet || {}
      // Skip "Topic" auto-generated channels
      if ((snippet.channelTitle || '').includes('- Topic')) return false
      const vidTitle = normalise(snippet.title || '')
      const channel = normalise(snippet.channelTitle || '')
      const desc = normalise(snippet.description || '')
      // Must match artist name
      const hasArtist = vidTitle.includes(targetArtist) || channel.includes(targetArtist) || desc.includes(targetArtist)
      if (!hasArtist) return false
      // Must match album/track title (core words)
      if (titleWords.length > 3) {
        const hasTitle = vidTitle.includes(titleWords)
        if (!hasTitle) return false
      }
      return true
    })
    .slice(0, maxResults)
    .map(item => ({
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      title: item.snippet.title || ''
    }))
}

/**
 * Syncs YouTube videos to videos.json files for all albums.
 * Only creates videos.json if one doesn't already exist.
 * Searches for "{artist} {album} official" to prioritise official content.
 *
 * @param {string} apiKey
 * @param {string} cachePath
 * @param {string} contentDir
 * @param {object} options - { overwrite: false, maxResults: 3 }
 */
async function syncYouTube (apiKey, cachePath, contentDir, options = {}) {
  const overwrite = options.overwrite || false
  const maxResults = options.maxResults || 2
  const artistFilter = options.artistFilter || null

  let cache = null
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) } catch { /* no cache */ }
  if (!cache) {
    console.warn('[youtube] No cache found.')
    return
  }

  let artists = cache.artists || []
  if (artistFilter) {
    const filterLower = artistFilter.toLowerCase()
    const filterSlug = toSlug(artistFilter)
    artists = artists.filter(a => {
      const aSlug = toSlug(a.name)
      return aSlug === filterSlug || a.name.toLowerCase() === filterLower
    })
    if (artists.length === 0) {
      console.error(`[youtube] No artist matching "${artistFilter}" found in cache.`)
      return
    }
    console.log(`[youtube] Filtering to artist: ${artists[0].name}`)
  }

  let searched = 0
  let created = 0
  let skipped = 0

  for (const artist of artists) {
    const artistSlug = toSlug(artist.name)
    console.log(`\n[${artist.name}]`)

    for (const album of artist.albums || []) {
      const albumSlug = album.slug || toSlug(album.title)
      const albumDir = path.join(contentDir, artistSlug, albumSlug)
      const videosPath = path.join(albumDir, 'videos.json')

      // Skip if videos.json already exists and we're not overwriting
      if (!overwrite && fs.existsSync(videosPath)) {
        skipped++
        continue
      }

      await delay(DELAY_MS)
      const results = await searchYouTube(apiKey, artist.name, album.title, maxResults)
      searched++

      if (results.length > 0) {
        fs.mkdirSync(albumDir, { recursive: true })
        fs.writeFileSync(videosPath, JSON.stringify(results, null, 2), 'utf8')
        console.log(`  ✓ ${albumSlug} → ${results.length} video(s)`)
        created++
      } else {
        console.log(`  – ${albumSlug} → no results`)
      }
    }
  }

  console.log(`\nYouTube sync complete: ${searched} searched, ${created} created, ${skipped} skipped (existing).`)
}

module.exports = { searchYouTube, syncYouTube }
