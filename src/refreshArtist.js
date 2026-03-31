'use strict'

const bandcamp = require('../lib/index.js')
const { readCache, writeCache } = require('./cache')
const { toSlug } = require('./slugs')

const DELAY_MS = 1500

function promisify (fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
  })
}

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Re-scrapes a single artist and updates the cache in place.
 * Matches by artist name or slug.
 *
 * @param {string} cachePath
 * @param {string} artistFilter - artist name or slug to match
 */
async function refreshArtist (cachePath, artistFilter) {
  const data = await readCache(cachePath)
  if (!data) {
    console.error('[refresh-artist] No cache found — run without flags first.')
    return
  }

  const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const filterNorm = normalise(artistFilter)

  const artist = data.artists.find(a =>
    normalise(a.name) === filterNorm || toSlug(a.name) === artistFilter.toLowerCase()
  )

  if (!artist) {
    console.error(`[refresh-artist] Artist not found: "${artistFilter}"`)
    console.log('Available artists:', data.artists.map(a => a.name).join(', '))
    return
  }

  console.log(`Re-scraping ${artist.name} (${artist.url})...`)

  let artistInfo
  try {
    await delay(DELAY_MS)
    artistInfo = await promisify(bandcamp.getArtistInfo.bind(bandcamp), artist.url)
  } catch (err) {
    console.error(`  Error fetching artist info: ${err.message}`)
    return
  }

  // Use getAlbumUrls (/music) to get the complete album list
  let albumUrls = []
  try {
    await delay(DELAY_MS)
    albumUrls = await promisify(bandcamp.getAlbumUrls.bind(bandcamp), artist.url)
  } catch (err) {
    console.warn(`  Could not fetch full album list, using artist page albums`)
    albumUrls = (artistInfo.albums || []).map(a => a.url)
  }
  if (albumUrls.length === 0) albumUrls = (artistInfo.albums || []).map(a => a.url)

  const albums = []
  for (const albumUrl of albumUrls) {
    try {
      console.log(`  → Album: ${albumUrl}`)
      await delay(DELAY_MS)
      const albumInfo = await promisify(bandcamp.getAlbumInfo.bind(bandcamp), albumUrl)
      if (albumInfo) {
        // Preserve existing enrichment data (streamingLinks, upc, discogs etc.)
        const existing = artist.albums.find(a => a.url === albumUrl)
        albums.push({
          url: albumUrl,
          title: albumInfo.title,
          artist: albumInfo.artist,
          imageUrl: albumInfo.imageUrl,
          tracks: albumInfo.tracks,
          tags: albumInfo.tags,
          raw: albumInfo.raw,
          // Preserve enriched data from previous runs
          streamingLinks: existing ? existing.streamingLinks : undefined,
          upc: existing ? existing.upc : undefined,
          discogsUrl: existing ? existing.discogsUrl : undefined,
          discogsSellUrl: existing ? existing.discogsSellUrl : undefined,
          physicalFormats: existing ? existing.physicalFormats : undefined,
          catalogNumber: existing ? existing.catalogNumber : undefined,
          labelName: existing ? existing.labelName : undefined,
          videos: existing ? existing.videos : undefined,
        })
      }
    } catch (err) {
      console.error(`    Error fetching album: ${err.message}`)
    }
  }

  console.log(`  ✓ ${artistInfo.name} — ${albums.length} album(s)`)

  // Update artist in cache
  const idx = data.artists.findIndex(a => a.url === artist.url)
  data.artists[idx] = {
    ...artist,
    name: artistInfo.name,
    location: artistInfo.location,
    description: artistInfo.description,
    coverImage: artistInfo.coverImage,
    bandLinks: artistInfo.bandLinks,
    albums
  }

  await writeCache(cachePath, data)
  console.log(`Cache updated for ${artistInfo.name}.`)
}

module.exports = { refreshArtist }
