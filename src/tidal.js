'use strict'

const https = require('https')
const querystring = require('querystring')

const DELAY_MS = 300
let _tokenCache = null

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function httpsRequest (options, body) {
  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null)
        try { resolve(JSON.parse(raw)) } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    if (body) req.write(body)
    req.end()
  })
}

function httpsGet (url, token) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'openapi.tidal.com',
      path: url,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json'
      }
    }
    https.get(opts, (res) => {
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
 * Gets a client_credentials access token from Tidal.
 */
async function getAccessToken (clientId, clientSecret) {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.token
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const body = 'grant_type=client_credentials'

  const data = await httpsRequest({
    hostname: 'auth.tidal.com',
    path: '/v1/oauth2/token',
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body)

  if (!data || !data.access_token) return null
  _tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000
  }
  return _tokenCache.token
}

/**
 * Looks up a Tidal album by UPC/barcode.
 * Returns { albumUrl, artistId } or null.
 */
async function lookupByUpc (token, upc) {
  const qs = querystring.stringify({ countryCode: 'US', 'filter[barcodeId]': upc })
  const data = await httpsGet(`/v2/albums?${qs}`, token)
  if (!data || !data.data || data.data.length === 0) return null
  const album = data.data[0]
  const id = album.id
  if (!id) return null
  const artistId = album.relationships &&
    album.relationships.artists &&
    album.relationships.artists.data &&
    album.relationships.artists.data[0] &&
    album.relationships.artists.data[0].id
  return { albumUrl: `https://tidal.com/browse/album/${id}`, artistId: artistId || null }
}

/**
 * Searches Tidal for an album by artist + title.
 * Returns { albumUrl, artistId } or null.
 */
async function searchAlbum (token, artistName, albumTitle) {
  const query = encodeURIComponent(`${artistName} ${albumTitle}`)
  const data = await httpsGet(`/v2/searchResults/${query}/relationships/albums?countryCode=US&include=albums`, token)
  if (!data) return null

  const items = (data.included || []).filter(i => i.type === 'albums')
  if (items.length === 0) return null

  const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const targetAlbum = normalise(albumTitle)

  const match = items.find(item => {
    const attrs = item.attributes || {}
    return normalise(attrs.title || '') === targetAlbum
  }) || items[0]

  if (!match) return null
  const artistId = match.relationships &&
    match.relationships.artists &&
    match.relationships.artists.data &&
    match.relationships.artists.data[0] &&
    match.relationships.artists.data[0].id
  return { albumUrl: `https://tidal.com/browse/album/${match.id}`, artistId: artistId || null }
}

/**
 * Searches Tidal for an artist by name.
 * Returns the Tidal artist URL or null.
 */
async function searchArtist (token, artistName) {
  const query = encodeURIComponent(artistName)
  const data = await httpsGet(`/v2/searchResults/${query}/relationships/artists?countryCode=US&include=artists`, token)
  if (!data) return null

  const items = (data.included || []).filter(i => i.type === 'artists')
  if (items.length === 0) return null

  const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const target = normalise(artistName)

  const match = items.find(item => {
    const attrs = item.attributes || {}
    return normalise(attrs.name || '') === target
  }) || items[0]

  return match ? `https://tidal.com/browse/artist/${match.id}` : null
}

/**
 * Enriches an artist with a Tidal artist URL.
 * Mutates artist.streamingLinks.tidal in place.
 */
async function enrichArtistWithTidal (artist, clientId, clientSecret) {
  if (artist.streamingLinks && artist.streamingLinks.tidal) return

  let token
  try {
    token = await getAccessToken(clientId, clientSecret)
  } catch (err) {
    console.warn(`  [tidal] Auth failed: ${err.message}`)
    return
  }
  if (!token) return

  try {
    await delay(DELAY_MS)
    const url = await searchArtist(token, artist.name)
    if (url) {
      artist.streamingLinks = artist.streamingLinks || {}
      artist.streamingLinks.tidal = url
      console.log(`  ✓ Tidal artist: "${artist.name}" → ${url}`)
    }
  } catch (err) {
    console.warn(`  ⚠ Tidal artist search failed for "${artist.name}": ${err.message}`)
  }
}

/**
 * Enriches albums with Tidal URLs.
 * Tries UPC lookup first, falls back to search.
 * Mutates each album in place.
 */
async function enrichAlbumsWithTidal (albums, artistName, clientId, clientSecret, artist) {
  let token
  try {
    token = await getAccessToken(clientId, clientSecret)
  } catch (err) {
    console.warn(`  [tidal] Auth failed: ${err.message}`)
    return
  }
  if (!token) {
    console.warn('  [tidal] Could not get access token')
    return
  }

  for (const album of albums) {
    if (album.streamingLinks && album.streamingLinks.tidal) continue
    try {
      await delay(DELAY_MS)
      let result = null
      if (album.upc) {
        result = await lookupByUpc(token, album.upc)
      }
      if (!result) {
        result = await searchAlbum(token, artistName, album.title)
      }
      if (result) {
        album.streamingLinks = album.streamingLinks || {}
        album.streamingLinks.tidal = result.albumUrl
        const method = album.upc ? `UPC ${album.upc}` : 'search'
        console.log(`    ✓ Tidal (${method}): "${album.title}"`)
        // If we got an artist ID and the artist doesn't have a Tidal URL yet, set it
        if (result.artistId && artist && !(artist.streamingLinks && artist.streamingLinks.tidal)) {
          artist.streamingLinks = artist.streamingLinks || {}
          artist.streamingLinks.tidal = `https://tidal.com/browse/artist/${result.artistId}`
          console.log(`  ✓ Tidal artist (from album): "${artistName}" → ${artist.streamingLinks.tidal}`)
        }
      }
    } catch (err) {
      console.warn(`    ⚠ Tidal failed for "${album.title}": ${err.message}`)
    }
  }
}

module.exports = { enrichAlbumsWithTidal, enrichArtistWithTidal, lookupByUpc, searchAlbum, searchArtist, getAccessToken }
