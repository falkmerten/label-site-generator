'use strict'

const https = require('https')
const querystring = require('querystring')

const DELAY_MS = 500 // Deezer free API — be polite

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function httpsGet (url) {
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
 * Looks up a Deezer album by UPC.
 * Returns { albumUrl, artistUrl } or null.
 */
async function lookupByUpc (upc) {
  const url = `https://api.deezer.com/album/upc:${encodeURIComponent(upc)}`
  const data = await httpsGet(url)
  if (!data || data.error || !data.link) return null
  return {
    albumUrl: data.link,
    artistUrl: (data.artist && data.artist.link) || null
  }
}

/**
 * Searches Deezer for an album by artist + title.
 * Returns { albumUrl, artistUrl } or null.
 */
async function searchAlbum (artistName, albumTitle) {
  const q = `artist:"${artistName}" album:"${albumTitle}"`
  const qs = querystring.stringify({ q, limit: 5 })
  const url = `https://api.deezer.com/search/album?${qs}`
  const data = await httpsGet(url)
  if (!data || !data.data || data.data.length === 0) return null

  const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const targetArtist = normalise(artistName)
  const targetAlbum = normalise(albumTitle)

  const match = data.data.find(r =>
    normalise(r.artist && r.artist.name || '') === targetArtist &&
    normalise(r.title || '') === targetAlbum
  ) || data.data.find(r =>
    normalise(r.artist && r.artist.name || '') === targetArtist
  )

  if (!match || !match.link) return null
  return {
    albumUrl: match.link,
    artistUrl: (match.artist && match.artist.link) || null
  }
}

/**
 * Enriches albums with Deezer URLs.
 * Also sets artist.streamingLinks.deezer if found.
 * Mutates in place.
 */
async function enrichAlbumsWithDeezer (albums, artistName, artist) {
  for (const album of albums) {
    if (album.streamingLinks && album.streamingLinks.deezer) continue
    try {
      await delay(DELAY_MS)
      let result = null
      if (album.upc) result = await lookupByUpc(album.upc)
      if (!result) result = await searchAlbum(artistName, album.title)
      if (result) {
        album.streamingLinks = album.streamingLinks || {}
        album.streamingLinks.deezer = result.albumUrl
        const method = album.upc ? `UPC ${album.upc}` : 'search'
        console.log(`    ✓ Deezer (${method}): "${album.title}"`)
        if (artist && result.artistUrl && !(artist.streamingLinks && artist.streamingLinks.deezer)) {
          artist.streamingLinks = artist.streamingLinks || {}
          artist.streamingLinks.deezer = result.artistUrl
          console.log(`  ✓ Deezer artist: "${artistName}"`)
        }
      }
    } catch (err) {
      console.warn(`    ⚠ Deezer failed for "${album.title}": ${err.message}`)
    }
  }
}

module.exports = { enrichAlbumsWithDeezer, lookupByUpc, searchAlbum }
