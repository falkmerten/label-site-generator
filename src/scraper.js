const bandcamp = require('./bandcamp.js')
const fs = require('fs/promises')
const path = require('path')
const { getLabelArtistUrls } = require('./bandcampApi')

const DELAY_MS = 1500 // delay between requests to avoid rate limiting

/**
 * Waits for a given number of milliseconds.
 */
function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Strips query string and hash from a URL, returning just the origin + pathname.
 * Also normalises double slashes in the path.
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
  let siteMode = process.env.SITE_MODE || 'label'

  // Step 1: Try API if credentials available
  if (apiCredentials && apiCredentials.clientId && apiCredentials.clientSecret) {
    try {
      artistUrls = await getLabelArtistUrls(apiCredentials.clientId, apiCredentials.clientSecret)
      if (artistUrls && artistUrls.length > 0) {
        siteMode = 'label'
        console.log(`Bandcamp API: found ${artistUrls.length} artist(s) (label account)`)
      }
    } catch (err) {
      console.warn(`  API roster fetch failed (${err.message}), falling back to scraping...`)
      artistUrls = null
    }
  }

  // Step 2: Try /artists page (label account detection)
  if (!artistUrls) {
    console.log(`Detecting Bandcamp account type for ${labelUrl}...`)
    try {
      const rawArtistUrls = await bandcamp.getArtistUrls(labelUrl)
      artistUrls = [...new Set(rawArtistUrls.map(cleanUrl))]
      if (artistUrls.length > 0) {
        siteMode = 'label'
        console.log(`  Label account detected (${artistUrls.length} artist(s) on /artists page)`)
      }
    } catch (err) {
      if (err.message && err.message.includes('404')) {
        // No /artists page - artist/band account
        console.log('  Artist/band account detected (no /artists page)')
        artistUrls = [labelUrl.replace(/\/+$/, '')]
      } else {
        throw err
      }
    }
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
      artistInfo = await bandcamp.getArtistInfo(artistUrl)
    } catch (err) {
      console.error(`  Error fetching artist info for ${artistUrl}:`, err.message || err)
      continue
    }

    // Use getAlbumUrls (which fetches /music) to get the complete album list
    let fullAlbumUrls = []
    try {
      await delay(DELAY_MS)
      fullAlbumUrls = await bandcamp.getAlbumUrls(artistUrl)
    } catch (err) {
      console.warn(`  Could not fetch full album list for ${artistUrl}, using artist page albums`)
      fullAlbumUrls = (artistInfo.albums || []).map(a => a.url)
    }

    // Merge: use full album URL list, fall back to artist page if empty
    const albumUrlsToScrape = (fullAlbumUrls.length > 0
      ? fullAlbumUrls
      : (artistInfo.albums || []).map(a => a.url)
    ).map(u => u.replace(/(https?:\/\/)|(\/)+/g, (m, proto) => proto || '/'))

    const albums = []
    for (const albumUrl of albumUrlsToScrape) {
      let albumInfo
      try {
        console.log(`  → Album: ${albumUrl}`)
        await delay(DELAY_MS)
        albumInfo = await bandcamp.getAlbumInfo(albumUrl)
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

    artists.push({
      url: artistUrl,
      name: artistInfo.name,
      location: artistInfo.location,
      description: artistInfo.description,
      coverImage: artistInfo.coverImage,
      bandLinks: artistInfo.bandLinks,
      streamingLinks: undefined,
      albums
    })
  }

  console.log(`Scraping complete. ${artists.length} artist(s) collected.`)

  // ── Fetch label profile image (for auto-logo) ────────────────────────────
  let labelProfileImage = null
  if (labelUrl) {
    try {
      labelProfileImage = await bandcamp.getProfileImage(labelUrl)
    } catch { /* non-fatal */ }
  }

  // ── Extract Bandcamp theme colors ─────────────────────────────────────────
  let themeColors = {}
  if (labelUrl) {
    try {
      themeColors = await bandcamp.getThemeColors(labelUrl)
      if (Object.keys(themeColors).length > 0) {
        console.log(`  Extracted Bandcamp theme colors: ${JSON.stringify(themeColors)}`)
      }
    } catch { /* non-fatal */ }
  }

  // ── Regroup albums by artist field (for band accounts acting as labels) ───
  // When the primary Bandcamp URL is a band account (not a label account with /artists page),
  // albums may belong to different artists. Regroup them by the album's artist field.
  // This applies to the FIRST artist only (extra artists from extra-artists.txt are separate accounts).
  const primaryArtist = artists[0]
  if (primaryArtist && primaryArtist.albums.length > 0) {
    const singleArtist = primaryArtist
    const albumsByArtist = {}
    for (const album of singleArtist.albums) {
      const artistName = (album.artist || singleArtist.name || 'Unknown').trim()
      if (!albumsByArtist[artistName]) {
        albumsByArtist[artistName] = []
      }
      albumsByArtist[artistName].push(album)
    }

    const uniqueArtists = Object.keys(albumsByArtist)
    if (uniqueArtists.length > 1) {
      console.log(`  Regrouping ${singleArtist.albums.length} album(s) into ${uniqueArtists.length} artist(s) (band account with multiple artists)`)
      // Replace the primary artist with the regrouped artists, keep extra artists
      const extraArtists = artists.slice(1)
      artists.length = 0
      for (const [name, albums] of Object.entries(albumsByArtist)) {
        artists.push({
          url: singleArtist.url,
          name,
          location: name === singleArtist.name ? singleArtist.location : null,
          description: name === singleArtist.name ? singleArtist.description : '',
          coverImage: name === singleArtist.name ? singleArtist.coverImage : null,
          bandLinks: name === singleArtist.name ? singleArtist.bandLinks : [],
          streamingLinks: undefined,
          albums
        })
        console.log(`    ${name}: ${albums.length} album(s)`)
      }
      // Re-add extra artists after the regrouped ones
      artists.push(...extraArtists)
    }
  }

  // ── Scrape label page for compilations (Various Artists) ──────────────────
  if (labelUrl) {
    const labelClean = cleanUrl(labelUrl)
    // Only scrape if the label URL isn't already in the artist list
    // Normalize both sides (strip trailing slash) to avoid false mismatches
    const labelOrigin = labelClean.replace(/\/+$/, '')
    if (!artistUrls.some(u => u.replace(/\/+$/, '') === labelOrigin)) {
      try {
        console.log(`\nScraping label page for compilations: ${labelClean}`)
        await delay(DELAY_MS)
        const labelAlbumUrls = await bandcamp.getAlbumUrls(labelClean)
        // Filter to albums not already scraped under any artist
        const allScrapedUrls = new Set()
        for (const a of artists) {
          for (const al of a.albums) {
            if (al.url) allScrapedUrls.add(al.url.replace(/\/+$/, ''))
          }
        }
        const unscrapedUrls = labelAlbumUrls.filter(u => !allScrapedUrls.has(u.replace(/\/+$/, '')))
        if (unscrapedUrls.length > 0) {
          console.log(`  Found ${unscrapedUrls.length} unscraped album(s) on label page`)
          const compilationAlbums = []
          for (const albumUrl of unscrapedUrls) {
            try {
              await delay(DELAY_MS)
              const albumInfo = await bandcamp.getAlbumInfo(albumUrl)
              if (!albumInfo) continue

              // Check the actual artist field from Bandcamp
              const bcArtist = (albumInfo.artist || '').toLowerCase().trim()
              const isCompilation = bcArtist === 'various artists' || bcArtist === 'various'

              if (isCompilation) {
                console.log(`  → Compilation: "${albumInfo.title}" (${albumUrl})`)
                compilationAlbums.push({
                  url: albumUrl,
                  title: albumInfo.title,
                  artist: 'Various Artists',
                  imageUrl: albumInfo.imageUrl,
                  tracks: albumInfo.tracks,
                  tags: albumInfo.tags,
                  raw: albumInfo.raw
                })
              } else {
                // Not a compilation — it's a regular album by a specific artist
                // that happens to be on the label page. Skip it (it belongs to
                // the artist's own page, or was already scraped there).
                console.log(`  – Skipped (artist: "${albumInfo.artist}"): "${albumInfo.title}" (${albumUrl})`)
              }
            } catch (err) {
              console.warn(`    Error: ${err.message}`)
            }
          }
          if (compilationAlbums.length > 0) {
            artists.push({
              url: labelClean,
              name: 'Various Artists',
              location: null,
              description: null,
              coverImage: null,
              bandLinks: [],
              streamingLinks: undefined,
              albums: compilationAlbums
            })
            console.log(`  ✓ Various Artists — ${compilationAlbums.length} compilation(s)`)
          } else {
            console.log('  No compilations found on label page')
          }
        } else {
          console.log('  No unscraped albums found on label page')
        }
      } catch (err) {
        console.warn(`  Could not scrape label page: ${err.message}`)
      }
    }
  }

  return {
    scrapedAt: new Date().toISOString(),
    labelProfileImage,
    themeColors,
    _siteMode: siteMode,
    artists
  }
}

module.exports = { scrapeLabel, loadExtraArtistUrls }
