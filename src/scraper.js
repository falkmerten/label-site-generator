const bandcamp = require('../lib/index.js')
const fs = require('fs/promises')
const path = require('path')
const { getLabelArtistUrls } = require('./bandcampApi')
const { enrichAlbumsWithStreamingLinks, fetchArtistStreamingLinks } = require('./odesli')

const DELAY_MS = 1500 // delay between requests to avoid rate limiting

/**
 * Wraps a callback-based bandcamp function in a Promise.
 */
function promisify (fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
  })
}

/**
 * Waits for a given number of milliseconds.
 */
function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Strips query string and hash from a URL, returning just the origin + pathname.
 * e.g. https://artist.bandcamp.com/?label=123&tab=artists → https://artist.bandcamp.com/
 */
function cleanUrl (rawUrl) {
  try {
    const u = new URL(rawUrl)
    return u.origin + '/'
  } catch {
    return rawUrl
  }
}

/**
 * Returns the /music URL for an artist to ensure all releases are listed.
 */
function musicUrl (artistUrl) {
  try {
    const u = new URL(artistUrl)
    return u.origin + '/music'
  } catch {
    return artistUrl
  }
}

/**
 * Loads extra artist URLs from content/extra-artists.txt (one URL per line).
 * Lines starting with # are treated as comments and ignored.
 */
async function loadExtraArtistUrls (contentDir) {
  const filePath = path.join(contentDir, 'extra-artists.txt')
  try {
    const text = await fs.readFile(filePath, 'utf8')
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(cleanUrl)
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[scraper] Could not read ${filePath}:`, err.message)
    return []
  }
}

/**
 * Scrapes all artist and album data from a Bandcamp label page.
 * Uses the Bandcamp API for the artist roster if credentials are provided,
 * otherwise falls back to scraping the label page.
 * Extra artist URLs from content/extra-artists.txt are always merged in.
 *
 * @param {string} labelUrl - The label's Bandcamp URL
 * @param {object} [apiCredentials] - Optional { clientId, clientSecret }
 * @param {string} [contentDir] - Path to content directory (for extra-artists.txt)
 * @returns {Promise<RawSiteData>}
 */
async function scrapeLabel (labelUrl, apiCredentials, contentDir = './content') {
  let artistUrls

  if (apiCredentials && apiCredentials.clientId && apiCredentials.clientSecret) {
    try {
      artistUrls = await getLabelArtistUrls(apiCredentials.clientId, apiCredentials.clientSecret)
    } catch (err) {
      console.warn(`  API roster fetch failed (${err.message}), falling back to scraping...`)
      artistUrls = null
    }
  }

  if (!artistUrls) {
    console.log(`Fetching artist list from ${labelUrl}...`)
    const rawArtistUrls = await promisify(bandcamp.getArtistUrls.bind(bandcamp), labelUrl)
    artistUrls = [...new Set(rawArtistUrls.map(cleanUrl))]
  }

  // Merge in any extra URLs from content/extra-artists.txt and EXTRA_ARTIST_URLS env var
  const extraUrls = await loadExtraArtistUrls(contentDir)
  const envExtra = (process.env.EXTRA_ARTIST_URLS || '')
    .split(',')
    .map(u => u.trim())
    .filter(Boolean)
    .map(cleanUrl)
  const allExtra = [...new Set([...extraUrls, ...envExtra])]
  if (allExtra.length > 0) {
    console.log(`Adding ${allExtra.length} extra artist(s)`)
    artistUrls = [...new Set([...artistUrls, ...allExtra])]
  }

  console.log(`Found ${artistUrls.length} artist(s) total.`)

  const artists = []

  for (const [i, artistUrl] of artistUrls.entries()) {
    let artistInfo
    try {
      console.log(`[${i + 1}/${artistUrls.length}] Scraping artist: ${artistUrl}`)
      await delay(DELAY_MS)
      artistInfo = await promisify(bandcamp.getArtistInfo.bind(bandcamp), artistUrl)
    } catch (err) {
      console.error(`  Error fetching artist info for ${artistUrl}:`, err.message || err)
      continue
    }

    // Use getAlbumUrls (which fetches /music) to get the complete album list
    let fullAlbumUrls = []
    try {
      await delay(DELAY_MS)
      fullAlbumUrls = await promisify(bandcamp.getAlbumUrls.bind(bandcamp), artistUrl)
    } catch (err) {
      console.warn(`  Could not fetch full album list for ${artistUrl}, using artist page albums`)
      fullAlbumUrls = (artistInfo.albums || []).map(a => a.url)
    }

    // Merge: use full album URL list, fall back to artist page if empty
    const albumUrlsToScrape = fullAlbumUrls.length > 0
      ? fullAlbumUrls
      : (artistInfo.albums || []).map(a => a.url)

    const albums = []
    for (const albumUrl of albumUrlsToScrape) {
      let albumInfo
      try {
        console.log(`  → Album: ${albumUrl}`)
        await delay(DELAY_MS)
        albumInfo = await promisify(bandcamp.getAlbumInfo.bind(bandcamp), albumUrl)
      } catch (err) {
        console.error(`    Error fetching album info for ${albumUrl}:`, err.message || err)
        continue
      }

      if (albumInfo) {
        albums.push({
          url: albumUrl,
          title: albumInfo.title,
          artist: albumInfo.artist,
          imageUrl: albumInfo.imageUrl,
          tracks: albumInfo.tracks,
          tags: albumInfo.tags,
          raw: albumInfo.raw
        })
      }
    }

    console.log(`  ✓ ${artistInfo.name} — ${albums.length} album(s)`)

    // Enrich with streaming links via Odesli
    if (albums.length > 0) {
      console.log(`  → Fetching streaming links for ${artistInfo.name}...`)
      await enrichAlbumsWithStreamingLinks(albums, artistInfo.name)
    }
    const artistStreamingLinks = await fetchArtistStreamingLinks(artistUrl)

    artists.push({
      url: artistUrl,
      name: artistInfo.name,
      location: artistInfo.location,
      description: artistInfo.description,
      coverImage: artistInfo.coverImage,
      bandLinks: artistInfo.bandLinks,
      streamingLinks: artistStreamingLinks || undefined,
      albums
    })
  }

  console.log(`Scraping complete. ${artists.length} artist(s) collected.`)
  return {
    scrapedAt: new Date().toISOString(),
    artists
  }
}

module.exports = { scrapeLabel }
