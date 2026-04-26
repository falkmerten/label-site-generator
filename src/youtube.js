'use strict'

const https = require('https')
const fs = require('fs')
const path = require('path')
const { toSlug } = require('./slugs')

const DELAY_MS = 200

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

let _quotaExhausted = false

function httpsGet (url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let raw = ''
      res.on('data', c => { raw += c })
      res.on('end', () => {
        if (res.statusCode === 403) {
          try {
            const err = JSON.parse(raw)
            if (err.error && err.error.errors && err.error.errors[0] && err.error.errors[0].reason === 'quotaExceeded') {
              console.error('[youtube] ✖ YouTube API daily quota exceeded. Quota resets at midnight Pacific Time (PT). Try again after ' + _nextResetTime() + '.')
              _quotaExhausted = true
              return resolve({ quotaExceeded: true })
            }
          } catch { /* not JSON */ }
          return resolve(null)
        }
        if (res.statusCode !== 200) return resolve(null)
        try { resolve(JSON.parse(raw)) } catch { resolve(null) }
      })
    }).on('error', () => resolve(null))
  })
}

function _nextResetTime () {
  const now = new Date()
  const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const tomorrow = new Date(pt)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  const diffMs = tomorrow - pt
  const hours = Math.ceil(diffMs / 3600000)
  return `~${hours} hour(s) from now`
}

/**
 * Resolves a YouTube @handle to a channel ID using the YouTube Data API.
 * @param {string} apiKey
 * @param {string} handle - e.g. "@aenaosrecords"
 * @returns {Promise<string|null>} Channel ID (UCxxxx) or null
 */
async function resolveHandle (apiKey, handle) {
  const cleanHandle = handle.replace(/^@/, '')
  const params = new URLSearchParams({ part: 'id', forHandle: cleanHandle, key: apiKey })
  const data = await httpsGet(`https://www.googleapis.com/youtube/v3/channels?${params}`)
  if (!data || data.quotaExceeded || !data.items || data.items.length === 0) return null
  return data.items[0].id
}

/**
 * Resolves all @handle entries in youtube.json to UC... channel IDs.
 * Updates the file in place.
 * @param {string} apiKey
 * @param {string} contentDir
 */
async function resolveYouTubeHandles (apiKey, contentDir) {
  const configPath = path.join(contentDir, 'youtube.json')
  let config
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch { console.error('[youtube] No youtube.json found.'); return }

  let resolved = 0

  // Resolve label channel
  if (config.labelChannel && config.labelChannel.includes('/@')) {
    const handle = config.labelChannel.match(/@([A-Za-z0-9_-]+)/)[1]
    console.log(`Resolving label channel @${handle}...`)
    await delay(DELAY_MS)
    const id = await resolveHandle(apiKey, handle)
    if (id) {
      config.labelChannel = `https://www.youtube.com/channel/${id}`
      console.log(`  ✓ @${handle} → ${id}`)
      resolved++
    } else {
      console.log(`  ✖ Could not resolve @${handle}`)
    }
  }

  // Resolve artist channels
  const artists = config.artists || config
  for (const [slug, url] of Object.entries(artists)) {
    if (!url || !url.includes('/@')) continue
    const handle = url.match(/@([A-Za-z0-9_-]+)/)[1]
    console.log(`Resolving ${slug} @${handle}...`)
    await delay(DELAY_MS)
    const id = await resolveHandle(apiKey, handle)
    if (id) {
      artists[slug] = `https://www.youtube.com/channel/${id}`
      console.log(`  ✓ @${handle} → ${id}`)
      resolved++
    } else {
      console.log(`  ✖ Could not resolve @${handle}`)
    }
  }

  if (resolved > 0) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
    console.log(`Resolved ${resolved} handle(s). Updated ${configPath}`)
  } else {
    console.log('No @handles to resolve.')
  }
}

/**
 * Extracts a YouTube channel ID from a channel URL.
 * Supports: /channel/UCxxxx, /c/name, /@handle
 * For @handle and /c/ URLs, returns the full URL (channelId search uses forHandle param).
 * @param {string} url
 * @returns {string|null}
 */
function extractChannelId (url) {
  if (!url) return null
  // Direct channel ID
  const m = url.match(/\/channel\/(UC[A-Za-z0-9_-]+)/)
  if (m) return m[1]
  // @handle — return the handle for forHandle lookup
  const h = url.match(/\/@([A-Za-z0-9_-]+)/)
  if (h) return '@' + h[1]
  return null
}

/**
 * Searches YouTube for videos within a specific channel.
 * @param {string} apiKey
 * @param {string} channelId - YouTube channel ID (UCxxxx)
 * @param {string} query - search query
 * @param {number} maxResults
 * @returns {Promise<Array<{url: string, title: string}>>}
 */
async function searchChannel (apiKey, channelIdOrHandle, query, maxResults = 2, allowedChannelIds = []) {
  if (_quotaExhausted) return []
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: String(maxResults + 3),
    key: apiKey
  })
  // UC... is a channel ID, @handle needs forHandle resolution first
  if (channelIdOrHandle.startsWith('UC')) {
    params.set('channelId', channelIdOrHandle)
  } else if (channelIdOrHandle.startsWith('@')) {
    // Search with channel handle in the query as workaround
    params.set('q', `${channelIdOrHandle} ${query}`)
  }
  const data = await httpsGet(`https://www.googleapis.com/youtube/v3/search?${params}`)
  if (!data || data.quotaExceeded || !data.items) return []

  const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const queryWords = normalise(query)

  // Build set of allowed channel IDs for strict filtering
  const allowed = new Set(allowedChannelIds.filter(Boolean))

  return data.items
    .filter(item => {
      if (!item.id || !item.id.videoId) return false
      const snippet = item.snippet || {}
      if ((snippet.channelTitle || '').includes('- Topic')) return false
      // Strict channel filter: only allow videos from configured channels
      if (allowed.size > 0 && snippet.channelId && !allowed.has(snippet.channelId)) return false
      // For channel search, just verify the query words appear in the title
      const vidTitle = normalise(snippet.title || '')
      return queryWords.length <= 3 || vidTitle.includes(queryWords)
    })
    .slice(0, maxResults)
    .map(item => ({
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      title: item.snippet.title || '',
      channelId: item.snippet.channelId || null,
      channelTitle: item.snippet.channelTitle || null
    }))
}

/**
 * Loads or creates content/youtube.json.
 * Format:
 * {
 *   "labelChannel": "https://www.youtube.com/channel/UCxxxx",
 *   "artists": {
 *     "artist-slug": "https://www.youtube.com/channel/UCyyyy",
 *     ...
 *   }
 * }
 * Merges Soundcharts-discovered channel URLs with existing entries.
 * @param {string} contentDir
 * @param {Array} artists - cache artists array
 * @returns {{ labelChannelId: string|null, artists: Object }}
 */
function loadOrCreateYouTubeConfig (contentDir, artists) {
  const configPath = path.join(contentDir, 'youtube.json')
  let config = { labelChannel: null, artists: {} }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    // Support old flat format (slug → url) and new format ({ labelChannel, artists })
    if (raw.artists && typeof raw.artists === 'object' && !Array.isArray(raw.artists)) {
      config = raw
    } else {
      // Migrate old flat format
      config.artists = {}
      for (const [key, val] of Object.entries(raw)) {
        if (key === 'labelChannel') config.labelChannel = val
        else config.artists[key] = val
      }
    }
  } catch { /* doesn't exist yet */ }

  let updated = false
  for (const artist of artists) {
    const slug = toSlug(artist.name)
    const scYoutube = (artist.streamingLinks || {}).youtube || null

    if (!(slug in config.artists)) {
      config.artists[slug] = scYoutube
      updated = true
    } else if (!config.artists[slug] && scYoutube) {
      config.artists[slug] = scYoutube
      updated = true
    }
  }

  if (updated) {
    const sorted = { labelChannel: config.labelChannel, artists: {} }
    for (const key of Object.keys(config.artists).sort()) {
      sorted.artists[key] = config.artists[key]
    }
    fs.mkdirSync(contentDir, { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(sorted, null, 2) + '\n', 'utf8')
    console.log(`[youtube] Updated ${configPath}`)
  }

  return {
    labelChannelId: extractChannelId(config.labelChannel),
    artists: config.artists
  }
}

/**
 * Syncs YouTube videos to videos.json files for all albums.
 * Uses channel-specific search when a YouTube channel is configured.
 * Skips artists without a channel URL (use content/{artist}/{album}/videos.json for manual links).
 *
 * @param {string} apiKey
 * @param {string} cachePath
 * @param {string} contentDir
 * @param {object} options - { overwrite, maxResults, artistFilter }
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

  // Load/create youtube.json config
  const ytConfig = loadOrCreateYouTubeConfig(contentDir, cache.artists || [])
  const labelChannelId = ytConfig.labelChannelId

  if (labelChannelId) {
    console.log(`[youtube] Label channel: ${labelChannelId}`)
  }

  let searched = 0
  let created = 0
  let skipped = 0
  let noChannel = 0

  for (const artist of artists) {
    if (_quotaExhausted) break

    const artistSlug = toSlug(artist.name)
    const channelUrl = ytConfig.artists[artistSlug] || null
    const artistChannelId = extractChannelId(channelUrl)

    if (!artistChannelId && !labelChannelId) {
      console.log(`[${artist.name}] No YouTube channel configured — skipping (add to content/youtube.json)`)
      noChannel++
      continue
    }

    // Collect allowed channel IDs for this artist
    const allowedIds = [labelChannelId, artistChannelId].filter(Boolean)

    console.log(`\n[${artist.name}]${artistChannelId ? ' Channel: ' + artistChannelId : ' (label channel only)'}`)

    for (const album of artist.albums || []) {
      if (_quotaExhausted) break

      const albumSlug = album.slug || toSlug(album.title)
      const albumDir = path.join(contentDir, artistSlug, albumSlug)
      const videosPath = path.join(albumDir, 'videos.json')

      if (!overwrite && fs.existsSync(videosPath)) {
        // Merge mode: load existing videos, only add new ones
        try {
          const existing = JSON.parse(fs.readFileSync(videosPath, 'utf8'))
          const existingUrls = new Set(existing.map(v => v.url))
          // Search for new videos to merge
          let newResults = []

          if (labelChannelId) {
            await delay(DELAY_MS)
            const labelResults = await searchChannel(apiKey, labelChannelId, `${artist.name} ${album.title}`, maxResults, allowedIds)
            searched++
            for (const r of labelResults) {
              if (!existingUrls.has(r.url)) newResults.push(r)
            }
          }
          if (artistChannelId && newResults.length < maxResults) {
            await delay(DELAY_MS)
            const artistResults = await searchChannel(apiKey, artistChannelId, album.title, maxResults, allowedIds)
            searched++
            for (const r of artistResults) {
              if (!existingUrls.has(r.url)) newResults.push(r)
            }
          }

          if (newResults.length > 0) {
            const merged = [...existing, ...newResults]
            fs.writeFileSync(videosPath, JSON.stringify(merged, null, 2), 'utf8')
            console.log(`  + ${albumSlug} → ${newResults.length} new video(s) merged (${merged.length} total)`)
            created++
          } else {
            skipped++
          }
          continue
        } catch { /* corrupt file, fall through to overwrite */ }
      }

      const seenVideoIds = new Set()
      let allResults = []

      // Search label channel first (preferred)
      if (labelChannelId) {
        await delay(DELAY_MS)
        const labelResults = await searchChannel(apiKey, labelChannelId, `${artist.name} ${album.title}`, maxResults, allowedIds)
        searched++
        for (const r of labelResults) {
          const vidId = r.url.split('v=')[1]
          if (!seenVideoIds.has(vidId)) {
            seenVideoIds.add(vidId)
            allResults.push(r)
          }
        }
      }

      // Then search artist channel for remaining slots
      if (artistChannelId && allResults.length < maxResults) {
        await delay(DELAY_MS)
        const artistResults = await searchChannel(apiKey, artistChannelId, album.title, maxResults - allResults.length, allowedIds)
        searched++
        for (const r of artistResults) {
          const vidId = r.url.split('v=')[1]
          if (!seenVideoIds.has(vidId)) {
            seenVideoIds.add(vidId)
            allResults.push(r)
          }
        }
      }

      // Fallback: track-by-track within artist channel
      if (allResults.length === 0 && artistChannelId && album.tracks && album.tracks.length > 0) {
        for (const track of album.tracks) {
          if (_quotaExhausted) break
          if (!track.name || allResults.length >= maxResults) break
          await delay(DELAY_MS)
          const tResults = await searchChannel(apiKey, artistChannelId, track.name, 1, allowedIds)
          searched++
          for (const r of tResults) {
            const vidId = r.url.split('v=')[1]
            if (!seenVideoIds.has(vidId)) {
              seenVideoIds.add(vidId)
              allResults.push(r)
            }
          }
        }
      }

      if (allResults.length > 0) {
        fs.mkdirSync(albumDir, { recursive: true })
        fs.writeFileSync(videosPath, JSON.stringify(allResults, null, 2), 'utf8')
        console.log(`  ✓ ${albumSlug} → ${allResults.length} video(s)`)
        created++
      } else {
        console.log(`  – ${albumSlug} → no results`)
      }
    }
  }

  console.log(`\nYouTube sync complete: ${searched} searched, ${created} created, ${skipped} skipped (existing), ${noChannel} artist(s) without channel.`)
}

module.exports = { searchChannel, syncYouTube, loadOrCreateYouTubeConfig, extractChannelId, resolveYouTubeHandles }
