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
async function scrapeLabel (labelUrl, apiCredentials, contentDir = './content', options = {}) {
  let artistUrls
  let siteMode = process.env.SITE_MODE || 'label'

  // ── Config-aware mode: if config.json exists, use it as source of truth ───
  let configDriven = false
  try {
    const configPath = path.join(contentDir, 'config.json')
    const configText = await fs.readFile(configPath, 'utf8')
    const config = JSON.parse(configText)

    if (config.site && config.site.mode) {
      siteMode = config.site.mode
    }

    // Build artist URL list from config.json (artists with bandcampUrl)
    if (config.artists) {
      const configUrls = []
      for (const [slug, artist] of Object.entries(config.artists)) {
        if (artist.enabled === false || artist.exclude === true) continue
        if (artist.bandcampUrl) {
          configUrls.push(cleanUrl(artist.bandcampUrl))
        }
      }

      if (configUrls.length > 0 || siteMode === 'label') {
        configDriven = true
        // Start with the label URL (for regrouped artists without own page)
        artistUrls = [labelUrl.replace(/\/+$/, '')]
        // Add all config artists with their own URLs
        for (const url of configUrls) {
          if (!artistUrls.some(u => u.replace(/\/+$/, '') === url.replace(/\/+$/, ''))) {
            artistUrls.push(url)
          }
        }
        console.log(`Config-driven scrape (${siteMode} mode, ${artistUrls.length} source(s))`)
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[scraper] Could not read config.json:`, err.message)
  }

  // ── Legacy mode: no config.json, detect account type ──────────────────────
  let detectedAccountType = 'unknown'
  if (!configDriven) {
    // Step 1: Try API if credentials available
    if (apiCredentials && apiCredentials.clientId && apiCredentials.clientSecret) {
      try {
        artistUrls = await getLabelArtistUrls(apiCredentials.clientId, apiCredentials.clientSecret)
        if (artistUrls && artistUrls.length > 0) {
          siteMode = 'label'
          detectedAccountType = 'label'
        }
      } catch (err) {
        artistUrls = null
      }
    }

    // Step 2: Try /artists page (label account detection)
    if (!artistUrls) {
      try {
        const rawArtistUrls = await bandcamp.getArtistUrls(labelUrl)
        artistUrls = [...new Set(rawArtistUrls.map(cleanUrl))]
        if (artistUrls.length > 0) {
          siteMode = 'label'
          detectedAccountType = 'label'
        }
      } catch (err) {
        if (err.message && err.message.includes('404')) {
          artistUrls = [labelUrl.replace(/\/+$/, '')]
          detectedAccountType = 'artist'
          // Will be refined after scrape (regrouping may detect artist-as-label)
        } else {
          throw err
        }
      }
    }
  }

  // Merge in any extra artist URLs (passed from generator prompt or config.json)
  const allExtra = (options && options.extraArtistUrls) || []
  if (allExtra.length > 0) {
    for (const url of allExtra) {
      const cleaned = cleanUrl(url)
      if (!artistUrls.some(u => u.replace(/\/+$/, '') === cleaned.replace(/\/+$/, ''))) {
        artistUrls.push(cleaned)
      }
    }
  }

  // ── Detection Summary ─────────────────────────────────────────────────────
  let connectedAccountNames = []
  if (!configDriven) {
    // Detect connected accounts via API (shown in summary, saved disabled in config)
    if (apiCredentials && apiCredentials.clientId && apiCredentials.clientSecret) {
      try {
        const { getAccessToken } = require('./bandcampApi')
        const { httpsPost } = require('./bandcampApi')
        const token = await getAccessToken(apiCredentials.clientId, apiCredentials.clientSecret)
        const res = await httpsPost('bandcamp.com', '/api/account/1/my_bands', {}, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        })
        const allBands = res.body.bands || []
        // Label entry has member_bands — those are already in artistUrls
        // Top-level bands WITHOUT member_bands are connected accounts
        const memberSubdomains = new Set(artistUrls.map(u => { try { return new URL(u).hostname.split('.')[0] } catch { return '' } }))
        for (const band of allBands) {
          if (!band.subdomain) continue
          if (band.member_bands && band.member_bands.length > 0) continue // this is the label itself
          if (memberSubdomains.has(band.subdomain)) continue
          connectedAccountNames.push(band.name || band.subdomain)
        }
      } catch { /* non-fatal */ }
    }

    console.log('')
    console.log('  Detected setup:')
    console.log(`    Bandcamp account type: ${detectedAccountType === 'label' ? 'Label' : 'Artist/Band'}`)
    console.log(`    Site mode: ${siteMode === 'label' ? 'Label (multi-artist)' : 'Artist (single band)'}`)
    console.log(`    Artists found: ${artistUrls.length}${allExtra.length > 0 ? ` (incl. ${allExtra.length} extra)` : ''}`)
    if (connectedAccountNames.length > 0) {
      console.log(`    Connected accounts: ${connectedAccountNames.length} (${connectedAccountNames.join(', ')})`)
    }
    if (apiCredentials && apiCredentials.clientId) {
      console.log('    Source: Bandcamp API')
    } else {
      console.log('    Source: Bandcamp HTML scrape')
    }
    console.log('')
  }

  const artists = []

  for (const [i, artistUrl] of artistUrls.entries()) {
    let artistInfo
    console.log(`[${i + 1}/${artistUrls.length}] Scraping artist: ${artistUrl}`)

    // Retry logic for transient network errors (DNS, timeouts)
    let retries = 3
    while (retries > 0) {
      try {
        await delay(DELAY_MS)
        artistInfo = await bandcamp.getArtistInfo(artistUrl)
        break // success
      } catch (err) {
        const isTransient = err.code === 'EAI_AGAIN' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET'
        retries--
        if (isTransient && retries > 0) {
          console.warn(`  ⚠ Network error (${err.code}), retrying in 3s... (${retries} retries left)`)
          await delay(3000)
        } else {
          console.error(`  Error fetching artist info for ${artistUrl}:`, err.message || err)
          break
        }
      }
    }
    if (!artistInfo) continue

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
        // Extract UPC from Bandcamp data if available (no API call needed)
        const rawUpc = albumInfo.raw && albumInfo.raw.current && albumInfo.raw.current.upc
        albums.push({
          url: albumUrl,
          title: albumInfo.title,
          artist: albumInfo.artist,
          imageUrl: albumInfo.imageUrl,
          tracks: albumInfo.tracks,
          tags: albumInfo.tags,
          raw: albumInfo.raw,
          upc: rawUpc || null
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
    // Group albums by normalized artist name (handles "Amáutica" vs "AMAUTICA" as same artist)
    const normalizeKey = s => s.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const albumsByKey = {}       // normalized key → albums[]
    const bestNameByKey = {}     // normalized key → best display name (prefer accents + mixed case)
    for (const album of singleArtist.albums) {
      const artistName = (album.artist || singleArtist.name || 'Unknown').trim()
      const key = normalizeKey(artistName)
      if (!albumsByKey[key]) {
        albumsByKey[key] = []
        bestNameByKey[key] = artistName
      }
      albumsByKey[key].push(album)
      // Prefer name with accents/mixed case over ALL CAPS
      if (artistName !== artistName.toUpperCase() && bestNameByKey[key] === bestNameByKey[key].toUpperCase()) {
        bestNameByKey[key] = artistName
      }
    }

    const uniqueKeys = Object.keys(albumsByKey)
    if (uniqueKeys.length > 1) {
      console.log(`  Regrouping ${singleArtist.albums.length} album(s) into ${uniqueKeys.length} artist(s) (band account with multiple artists)`)
      // Replace the primary artist with the regrouped artists, keep extra artists
      const extraArtists = artists.slice(1)
      artists.length = 0
      for (const key of uniqueKeys) {
        const name = bestNameByKey[key]
        const albums = albumsByKey[key]
        const isSameAsPrimary = normalizeKey(singleArtist.name) === key
        artists.push({
          url: singleArtist.url,
          name,
          location: isSameAsPrimary ? singleArtist.location : null,
          description: isSameAsPrimary ? singleArtist.description : '',
          coverImage: isSameAsPrimary ? singleArtist.coverImage : null,
          bandLinks: isSameAsPrimary ? singleArtist.bandLinks : [],
          streamingLinks: undefined,
          albums
        })
        console.log(`    ${name}: ${albums.length} album(s)`)
      }
      // Re-add extra artists after the regrouped ones
      artists.push(...extraArtists)
    }
  }

  // ── Deduplicate artists by name (regrouped + extra may overlap) ───────────
  // Use Unicode-normalized key so "Amáutica" and "AMAUTICA" match
  const artistsByName = new Map()
  for (const artist of artists) {
    const key = artist.name.toLowerCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (artistsByName.has(key)) {
      // Merge: keep the one with more data, combine albums
      const existing = artistsByName.get(key)
      // Prefer the name from the artist profile (has accents, proper casing)
      // Heuristic: name with diacritics wins; mixed case wins over ALL CAPS
      const existingNorm = existing.name.normalize('NFD')
      const incomingNorm = artist.name.normalize('NFD')
      const existingHasDiacritics = /[\u0300-\u036f]/.test(existingNorm)
      const incomingHasDiacritics = /[\u0300-\u036f]/.test(incomingNorm)
      if (incomingHasDiacritics && !existingHasDiacritics) {
        existing.name = artist.name
      } else if (!existingHasDiacritics && !incomingHasDiacritics &&
                 artist.name !== artist.name.toUpperCase() && existing.name === existing.name.toUpperCase()) {
        existing.name = artist.name
      }
      // Prefer the extra artist's URL (it's their own Bandcamp page)
      if (artist.url && artist.url !== existing.url && !artist.url.includes(labelUrl)) {
        existing.url = artist.url
      }
      // Prefer non-null fields from the extra artist
      if (!existing.coverImage && artist.coverImage) existing.coverImage = artist.coverImage
      if (!existing.location && artist.location) existing.location = artist.location
      if (!existing.description && artist.description) existing.description = artist.description
      if (artist.bandLinks && artist.bandLinks.length > 0 && (!existing.bandLinks || existing.bandLinks.length === 0)) {
        existing.bandLinks = artist.bandLinks
      }
      // Merge albums (deduplicate by title, Unicode-normalized)
      const existingTitles = new Set((existing.albums || []).map(a =>
        a.title.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      ))
      for (const album of artist.albums || []) {
        const normalizedTitle = album.title.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        if (!existingTitles.has(normalizedTitle)) {
          existing.albums.push(album)
        }
      }
      console.log(`  Merged duplicate artist "${artist.name}" (${artist.albums.length} album(s) from ${artist.url || 'regrouping'})`)
    } else {
      artistsByName.set(key, artist)
    }
  }
  artists.length = 0
  artists.push(...artistsByName.values())

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

        // Pre-filter: skip URLs whose hostname belongs to an already-scraped artist
        const scrapedSubdomains = new Set(artistUrls.map(u => { try { return new URL(u).hostname.split('.')[0] } catch { return '' } }).filter(Boolean))
        // Also add the label subdomain itself
        try { scrapedSubdomains.add(new URL(labelClean).hostname.split('.')[0]) } catch { /* */ }

        // Filter to albums on the LABEL subdomain only (not artist subdomains)
        // Albums on artist subdomains are already scraped under that artist
        const labelSubdomain = (() => { try { return new URL(labelClean).hostname.split('.')[0] } catch { return '' } })()
        const labelOnlyUrls = labelAlbumUrls.filter(u => {
          try {
            const hostname = new URL(u).hostname.split('.')[0]
            // Only keep URLs on the label's own subdomain
            return hostname === labelSubdomain
          } catch { return false }
        })

        // Further filter: remove URLs already scraped
        const allScrapedUrls = new Set()
        for (const a of artists) {
          for (const al of a.albums) {
            if (al.url) allScrapedUrls.add(al.url.replace(/[?#].*$/, '').replace(/\/+$/, ''))
          }
        }
        const unscrapedUrls = labelOnlyUrls.filter(u => !allScrapedUrls.has(u.replace(/[?#].*$/, '').replace(/\/+$/, '')))

        if (unscrapedUrls.length > 0) {
          console.log(`  Found ${unscrapedUrls.length} album(s) on label page to check for compilations`)
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
                const compUpc = albumInfo.raw && albumInfo.raw.current && albumInfo.raw.current.upc
                compilationAlbums.push({
                  url: albumUrl,
                  title: albumInfo.title,
                  artist: 'Various Artists',
                  imageUrl: albumInfo.imageUrl,
                  tracks: albumInfo.tracks,
                  tags: albumInfo.tags,
                  raw: albumInfo.raw,
                  upc: compUpc || null
                })
              } else {
                // Not a compilation — skip silently (already covered by artist scrape)
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

module.exports = { scrapeLabel }
