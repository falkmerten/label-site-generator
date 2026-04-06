'use strict'

const https = require('https')
const querystring = require('querystring')

const DELAY_MS = 200 // Spotify rate limit is generous, but be polite

let _tokenCache = null // { token, expiresAt }

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Fetches a client_credentials access token from Spotify.
 * Caches it until expiry.
 */
async function getAccessToken (clientId, clientSecret) {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.token
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const body = 'grant_type=client_credentials'

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try {
          const data = JSON.parse(raw)
          if (!data.access_token) return reject(new Error(`Spotify token error: ${data.error || 'unknown error'}`))
          _tokenCache = {
            token: data.access_token,
            expiresAt: Date.now() + (data.expires_in - 60) * 1000
          }
          resolve(_tokenCache.token)
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/**
 * Scores a Spotify search result against target artist/album.
 * Exported for testing. Used internally by searchAlbum.
 *
 * @param {object} item - Spotify album search result
 * @param {string} targetArtist - normalised target artist name
 * @param {string} targetAlbum - normalised target album title
 * @param {string|null} expectedAlbumType - 'album', 'single', or null
 * @returns {number} 0-4 score
 */
function scoreSearchResult (item, targetArtist, targetAlbum, expectedAlbumType) {
  const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const iArtist = normalise((item.artists && item.artists[0] ? item.artists[0].name : '') || '')
  const iAlbum = normalise(item.name || '')
  const artistMatch = iArtist === targetArtist
  const albumMatch = iAlbum === targetAlbum
  const typeMatch = expectedAlbumType ? item.album_type === expectedAlbumType : true

  // For short artist names (≤3 chars after normalisation), require exact album match too
  const shortArtist = targetArtist.length <= 3

  if (artistMatch && albumMatch && typeMatch) return 4
  if (artistMatch && albumMatch) return 3
  // Partial album match only allowed for longer artist names
  if (!shortArtist && artistMatch && typeMatch && targetAlbum.length >= 6 && iAlbum.includes(targetAlbum.slice(0, Math.min(targetAlbum.length, 12)))) return 2
  // Artist-only match is NOT sufficient — too many false positives
  return 0
}

/**
 * Searches Spotify for an album by artist name + album title.
 * Returns { spotifyUrl, upc } or null if not found.
 * UPC comes from the full album object fetched via /albums/{id}.
 *
 * @param {string} token - Spotify access token
 * @param {string} artistName
 * @param {string} albumTitle
 * @param {string} [itemType] - 'album' or 'track' from Bandcamp raw data
 * @returns {Promise<{spotifyUrl: string, upc: string|null}|null>}
 */
async function searchAlbum (token, artistName, albumTitle, itemType) {
  const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const targetArtist = normalise(artistName)
  const targetAlbum = normalise(albumTitle)

  // Safety: skip search if normalised artist or album is too short to be meaningful
  if (targetArtist.length < 2 || targetAlbum.length < 2) return null

  // Try field search first, then plain text fallback
  const queries = [
    `artist:${artistName} album:${albumTitle}`,
    `${artistName} ${albumTitle}`
  ]

  for (const q of queries) {
    const qs = querystring.stringify({ q, type: 'album', limit: 10, market: 'US' })
    const items = await new Promise((resolve) => {
      const options = {
        hostname: 'api.spotify.com',
        path: `/v1/search?${qs}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      }
      https.get(options, (res) => {
        let raw = ''
        res.on('data', chunk => { raw += chunk })
        res.on('end', () => {
          try {
            const data = JSON.parse(raw)
            resolve((data.albums && data.albums.items) || [])
          } catch { resolve([]) }
        })
      }).on('error', () => resolve([]))
    })

    if (items.length === 0) continue

    const expectedAlbumType = itemType === 'track' ? 'single' : itemType === 'album' ? 'album' : null

    const scored = items.map(item => ({ item, score: scoreSearchResult(item, targetArtist, targetAlbum, expectedAlbumType) })).filter(x => x.score > 0)
    if (scored.length === 0) continue
    scored.sort((a, b) => b.score - a.score)

    // Only accept matches with score >= 3 (artist + album match) for safety
    // Score 2 (partial album) is only accepted if there's exactly one candidate
    if (scored[0].score < 2) continue
    if (scored[0].score === 2 && scored.length > 1) continue

    const match = scored[0].item
    const upc = await getAlbumUpc(token, match.id)
    return { spotifyUrl: match.external_urls.spotify, upc }
  }

  return null
}

/**
 * Fetches the UPC for a Spotify album by its ID.
 *
 * @param {string} token
 * @param {string} albumId
 * @returns {Promise<string|null>}
 */
async function getAlbumUpc (token, albumId) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.spotify.com',
      path: `/v1/albums/${albumId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }
    https.get(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try {
          const data = JSON.parse(raw)
          resolve((data.external_ids && data.external_ids.upc) || null)
        } catch { resolve(null) }
      })
    }).on('error', () => resolve(null))
  })
}

/**
 * Fetches the UPC for a Spotify album given its full Spotify URL.
 * Extracts the album ID from the URL, then calls getAlbumUpc.
 *
 * @param {string} token
 * @param {string} spotifyUrl - e.g. https://open.spotify.com/album/6FbeljEMKV3VQP9pTExFio
 * @returns {Promise<string|null>}
 */
async function getAlbumUpcBySpotifyUrl (token, spotifyUrl) {
  try {
    const match = spotifyUrl.match(/album\/([A-Za-z0-9]+)/)
    if (!match) return null
    return await getAlbumUpc(token, match[1])
  } catch { return null }
}

/**
 * Searches Spotify for an artist page by name.
 * Returns the Spotify artist URL, or null if not found.
 *
 * @param {string} token
 * @param {string} artistName
 * @returns {Promise<string|null>}
 */
async function searchArtist (token, artistName) {
  const qs = querystring.stringify({ q: artistName, type: 'artist', limit: 3, market: 'US' })

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.spotify.com',
      path: `/v1/search?${qs}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }
    https.get(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try {
          const data = JSON.parse(raw)
          const items = data.artists && data.artists.items
          if (!items || items.length === 0) return resolve(null)
          const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
          const target = normalise(artistName)
          const match = items.find(item => normalise(item.name) === target) || items[0]
          resolve(match ? match.external_urls.spotify : null)
        } catch { resolve(null) }
      })
    }).on('error', () => resolve(null))
  })
}

/**
 * Enriches a list of albums with Spotify URLs and UPCs by searching artist+title.
 * Mutates each album in place, adding streamingLinks.spotify and upc if found.
 *
 * @param {Array} albums
 * @param {string} artistName
 * @param {string} clientId
 * @param {string} clientSecret
 */
async function enrichAlbumsWithSpotify (albums, artistName, clientId, clientSecret) {
  let token
  try {
    token = await getAccessToken(clientId, clientSecret)
  } catch (err) {
    console.warn(`  [spotify] Auth failed: ${err.message}`)
    return
  }

  for (const album of albums) {
    if (album.streamingLinks && album.streamingLinks.spotify) continue // already have it
    try {
      await delay(DELAY_MS)
      const result = await searchAlbum(token, artistName, album.title, album.itemType || (album.raw && album.raw.item_type))
      if (result) {
        album.streamingLinks = album.streamingLinks || {}
        album.streamingLinks.spotify = result.spotifyUrl
        if (result.upc) album.upc = result.upc
        console.log(`    ✓ Spotify: "${album.title}" → ${result.spotifyUrl}${result.upc ? ` (UPC: ${result.upc})` : ''}`)
      }
    } catch (err) {
      console.warn(`    ⚠ Spotify search failed for "${album.title}": ${err.message}`)
    }
  }
}

/**
 * Enriches an artist with a Spotify artist URL.
 * Mutates in place, adding streamingLinks.spotify if found.
 *
 * @param {object} artist
 * @param {string} clientId
 * @param {string} clientSecret
 */
async function enrichArtistWithSpotify (artist, clientId, clientSecret) {
  if (artist.streamingLinks && artist.streamingLinks.spotify) return
  let token
  try {
    token = await getAccessToken(clientId, clientSecret)
  } catch { return }

  try {
    await delay(DELAY_MS)
    const url = await searchArtist(token, artist.name)
    if (url) {
      artist.streamingLinks = artist.streamingLinks || {}
      artist.streamingLinks.spotify = url
      console.log(`  ✓ Spotify artist: "${artist.name}" → ${url}`)
    }
  } catch { /* ignore */ }
}
/**
 * Fetches all albums for a Spotify artist by their artist ID (extracted from URL).
 * Returns array of { spotifyUrl, upc, title } or empty array.
 *
 * @param {string} token
 * @param {string} artistUrl - e.g. https://open.spotify.com/artist/XXXXX
 * @returns {Promise<Array<{spotifyUrl: string, upc: string|null, title: string}>>}
 */
async function fetchArtistAlbums (token, artistUrl) {
  const match = artistUrl.match(/artist\/([A-Za-z0-9]+)/)
  if (!match) return []
  const artistId = match[1]

  const MAX_RETRIES = 3

  async function artistGet (path) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const result = await new Promise((resolve) => {
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
            resolve({ statusCode: res.statusCode, headers: res.headers, raw })
          })
        }).on('error', (err) => resolve({ statusCode: 0, headers: {}, raw: err.message }))
      })

      if (result.statusCode === 429 || result.raw === 'Too many requests') {
        const retryAfter = parseInt(result.headers['retry-after'] || '1', 10)
        if (retryAfter > 60) {
          const hours = Math.ceil(retryAfter / 3600)
          console.warn(`[warn] fetchArtistAlbums: Spotify rate limited for ~${hours}h (retry-after: ${retryAfter}s). Spotify rate limits reset after ~30 minutes of inactivity.`)
          // Throw a typed error so the enricher can catch it and disable Spotify
          const err = new Error(`Spotify rate limited (retry-after: ${retryAfter}s)`)
          err.statusCode = 429
          err.retryAfter = retryAfter
          throw err
        }
        // Exponential backoff: retryAfter * 2^attempt, capped at 30s
        const backoff = Math.min(retryAfter * Math.pow(2, attempt), 30)
        console.warn(`[warn] fetchArtistAlbums: rate limited — waiting ${backoff}s (attempt ${attempt + 1}/${MAX_RETRIES})`)
        await delay(backoff * 1000)
        continue
      }

      try {
        const data = JSON.parse(result.raw)
        if (result.statusCode !== 200) {
          console.warn(`[warn] fetchArtistAlbums: HTTP ${result.statusCode} — ${JSON.stringify(data).slice(0, 100)}`)
          return null
        }
        return data
      } catch {
        console.warn(`[warn] fetchArtistAlbums: unexpected response — ${result.raw.slice(0, 100)}`)
        return null
      }
    }
    console.warn(`[warn] fetchArtistAlbums: max retries exceeded for ${path}`)
    return null
  }

  // Fetch all pages — only album and single (not appears_on/compilation to avoid
  // pulling Various Artists compilations into individual artist catalogs)
  const allItems = []
  const seenIds = new Set()
  let offset = 0

  while (true) {
    const qs = `include_groups=album,single&offset=${offset}`
    const data = await artistGet(`/v1/artists/${artistId}/albums?${qs}`)

    if (!data || !data.items || data.items.length === 0) break
    for (const item of data.items) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id)
        allItems.push(item)
      }
    }
    if (!data.next) break
    offset += data.items.length
    await delay(DELAY_MS)
  }

  // Fetch UPCs and full metadata per album (batch endpoint restricted in dev mode)
  const results = []
  for (const item of allItems) {
    await delay(DELAY_MS)
    const upc = await getAlbumUpc(token, item.id)
    results.push({
      title: item.name,
      spotifyUrl: item.external_urls.spotify,
      upc,
      albumType: item.album_type,
      releaseDate: item.release_date ? new Date(item.release_date).toISOString() : null
    })
  }
  return results
}


/**
 * Fetches full album metadata from Spotify for Spotify-only albums.
 * Sets artwork, releaseDate, description (label), and tracks.
 *
 * @param {Array} albums - albums missing artwork
 * @param {string} token
 */
async function enrichSpotifyOnlyAlbums (albums, token) {
  for (const album of albums) {
    if (!album.streamingLinks || !album.streamingLinks.spotify) continue
    const m = album.streamingLinks.spotify.match(/album\/([A-Za-z0-9]+)/)
    if (!m) continue

    try {
      await delay(DELAY_MS)
      const data = await new Promise((resolve) => {
        const options = {
          hostname: 'api.spotify.com',
          path: `/v1/albums/${m[1]}`,
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` }
        }
        https.get(options, (res) => {
          let raw = ''
          res.on('data', chunk => { raw += chunk })
          res.on('end', () => {
            try { resolve(JSON.parse(raw)) } catch { resolve(null) }
          })
        }).on('error', () => resolve(null))
      })

      if (!data || data.error) continue

      if (data.images && data.images.length > 0) album.artwork = data.images[0].url
      if (data.release_date) album.releaseDate = new Date(data.release_date).toISOString()
      if (!album.description && data.label) album.description = `Label: ${data.label}`
      if (data.label || data.copyrights) {
        let spotifyLabelName = data.label
        if (!spotifyLabelName && data.copyrights) {
          // Prefer C-line (© = label/publisher) over P-line (℗ = sound recording, often artist name)
          const cLine = data.copyrights.find(c => c.type === 'C')
          const pLine = data.copyrights.find(c => c.type === 'P')
          const line = cLine || pLine || data.copyrights[0]
          if (line && line.text) spotifyLabelName = line.text.replace(/^[\u00A9\u2117\u2120\uFFFD©℗]+\s*\d{0,4}\s*/i, '').replace(/^\(\s*[CP]\s*\)\s*\d{0,4}\s*/i, '').replace(/^\d{3,4}\s+/, '').trim()
        }
        if (spotifyLabelName) {
          album.spotifyLabel = spotifyLabelName
          if (!album.labelName) {
            album.labelName = spotifyLabelName
            console.log(`    ✓ Spotify label: "${album.title}" → ${spotifyLabelName}`)
          }
        }
      }
      if ((!album.tracks || album.tracks.length === 0) && data.tracks && data.tracks.items) {
        album.tracks = data.tracks.items.map(t => ({ name: t.name, duration: t.duration_ms ? formatDuration(t.duration_ms) : null }))
      }
      if (!album.upc && data.external_ids && data.external_ids.upc) album.upc = data.external_ids.upc
      if ((!album.tags || album.tags.length === 0) && data.genres && data.genres.length > 0) album.tags = data.genres.map(g => ({ name: g }))

      console.log(`    ✓ Spotify metadata: "${album.title}" (artwork, ${album.tracks ? album.tracks.length + ' tracks' : 'no tracks'})`)
    } catch (err) {
      console.warn(`    ⚠ Spotify metadata failed for "${album.title}": ${err.message}`)
    }
  }
}

function formatDuration (ms) {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}:${s.toString().padStart(2, '0')}`
}

module.exports = { enrichAlbumsWithSpotify, enrichArtistWithSpotify, getAlbumUpcBySpotifyUrl, getAccessToken, fetchArtistAlbums, searchArtist, enrichSpotifyOnlyAlbums, getAlbumUpc, searchAlbum, scoreSearchResult }