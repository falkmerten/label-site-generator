'use strict'

const https = require('https')
const querystring = require('querystring')

const DELAY_MS = 500 // iTunes is generous but be polite

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
 * Looks up an Apple Music album URL by UPC.
 * Returns { albumUrl, artistUrl } or null.
 */
async function lookupByUpc (upc) {
  const url = `https://itunes.apple.com/lookup?upc=${encodeURIComponent(upc)}&entity=album&limit=1`
  const data = await httpsGet(url)
  if (!data || !data.results || data.results.length === 0) return null
  const album = data.results.find(r => r.wrapperType === 'collection' || r.collectionType === 'Album')
  if (!album || !album.collectionViewUrl) return null
  return { albumUrl: album.collectionViewUrl, artistUrl: album.artistViewUrl || null }
}

/**
 * Searches Apple Music for an album by artist + title.
 * Returns { albumUrl, artistUrl } or null.
 */
async function searchAlbum (artistName, albumTitle) {
  const term = `${artistName} ${albumTitle}`
  const qs = querystring.stringify({ term, entity: 'album', limit: 5, media: 'music' })
  const url = `https://itunes.apple.com/search?${qs}`
  const data = await httpsGet(url)
  if (!data || !data.results || data.results.length === 0) return null

  const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const targetArtist = normalise(artistName)
  const targetAlbum = normalise(albumTitle)

  const match = data.results.find(r =>
    normalise(r.artistName || '') === targetArtist &&
    normalise(r.collectionName || '') === targetAlbum
  ) || data.results.find(r =>
    normalise(r.artistName || '') === targetArtist
  )

  if (!match || !match.collectionViewUrl) return null
  return { albumUrl: match.collectionViewUrl, artistUrl: match.artistViewUrl || null }
}

/**
 * Enriches albums with Apple Music URLs.
 * Also sets artist.streamingLinks.appleMusic if found.
 * Mutates in place.
 */
async function enrichAlbumsWithItunes (albums, artistName, artist) {
  for (const album of albums) {
    if (album.streamingLinks && album.streamingLinks.appleMusic) continue
    try {
      await delay(DELAY_MS)
      let result = null
      if (album.upc) result = await lookupByUpc(album.upc)
      if (!result) result = await searchAlbum(artistName, album.title)
      if (result) {
        album.streamingLinks = album.streamingLinks || {}
        album.streamingLinks.appleMusic = result.albumUrl
        const method = album.upc ? `UPC ${album.upc}` : 'search'
        console.log(`    ✓ iTunes (${method}): "${album.title}"`)
        // Set artist-level Apple Music link if not already set
        if (artist && result.artistUrl && !(artist.streamingLinks && artist.streamingLinks.appleMusic)) {
          artist.streamingLinks = artist.streamingLinks || {}
          artist.streamingLinks.appleMusic = result.artistUrl
          console.log(`  ✓ iTunes artist: "${artistName}"`)
        }
      }
    } catch (err) {
      console.warn(`    ⚠ iTunes failed for "${album.title}": ${err.message}`)
    }
  }
}

module.exports = { enrichAlbumsWithItunes, lookupByUpc, searchAlbum }
