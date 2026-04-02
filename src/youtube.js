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
 * Returns array of { url, title } objects.
 *
 * @param {string} apiKey - YouTube Data API v3 key
 * @param {string} query - search query
 * @param {number} maxResults - max results (default 3)
 * @returns {Promise<Array<{url: string, title: string}>>}
 */
async function searchYouTube (apiKey, query, maxResults = 3) {
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: String(maxResults),
    key: apiKey
  })
  const data = await httpsGet(`https://www.googleapis.com/youtube/v3/search?${params}`)
  if (!data || !data.items) return []

  return data.items
    .filter(item => item.id && item.id.videoId)
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
  const maxResults = options.maxResults || 3

  let cache = null
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) } catch { /* no cache */ }
  if (!cache) {
    console.warn('[youtube] No cache found.')
    return
  }

  let searched = 0
  let created = 0
  let skipped = 0

  for (const artist of cache.artists || []) {
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
      const query = `${artist.name} ${album.title} official`
      const results = await searchYouTube(apiKey, query, maxResults)
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
