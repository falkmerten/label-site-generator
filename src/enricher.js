'use strict'

const fs = require('fs/promises')
const path = require('path')
const https = require('https')
const http = require('http')
const { readCache, writeCache } = require('./cache')
const { enrichAlbumsWithSpotify, enrichArtistWithSpotify, getAccessToken, fetchArtistAlbums, fetchArtistAlbumLinks, enrichSpotifyOnlyAlbums, searchAlbum: searchAlbumSpotify, fetchAlbumTrackIsrcs, getArtistImageUrl } = require('./spotify')
const { enrichAlbumsWithItunes } = require('./itunes')
const { enrichAlbumsWithDeezer } = require('./deezer')
const { enrichAlbumsWithTidal, enrichArtistWithTidal } = require('./tidal')
const { enrichAlbumsWithMusicFetch, enrichArtistWithMusicFetch } = require('./musicfetch')
const { enrichAlbumsWithDiscogs, lookupLabelUrl, hasActiveListings } = require('./discogs')
const { toSlug } = require('./slugs')
const { extractAlbumId, albumBelongsToArtist } = require('./merger')
const bandcamp = require('./bandcamp')
const { withRateLimit } = require('./rateLimiter')
const { loadConfig, writeConfig } = require('./configLoader')

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Validates and normalizes a date string to ISO 8601.
 * Returns null for invalid or missing dates.
 * @param {string|null} dateStr
 * @returns {string|null}
 */
function normalizeDate (dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

const {
  getArtistBySpotifyId,
  getArtistIdentifiers,
  getArtistAlbums,
  getAlbumBySpotifyId,
  getAlbumByUpc,
  getAlbumIdentifiers,
  getQuotaRemaining,
  getCallCount,
  resetCallCount,
  mapIdentifiersToLinks,
  categorizeLinks,
  getArtistEvents,
  scGet
} = require('./soundcharts')

/**
 * Runs async tasks with a maximum concurrency limit.
 * @param {Array} items
 * @param {number} concurrency
 * @param {Function} fn - async (item) => result
 */
async function pMap (items, concurrency, fn) {
  const results = []
  let index = 0
  async function worker () {
    while (index < items.length) {
      const i = index++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

/**
 * Loads content/artists.json if it exists.
 * Returns a map of artist-slug → { spotifyArtistUrl, ... }
 */
async function loadArtistConfig (contentDir) {
  try {
    const raw = await fs.readFile(path.join(contentDir, 'artists.json'), 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/**
 * Extracts a Spotify ID from a Spotify URL.
 * e.g. "https://open.spotify.com/artist/5Bzyx4ZD9pXFRJPBuiv1HY" → "5Bzyx4ZD9pXFRJPBuiv1HY"
 * @param {string} url
 * @returns {string|null}
 */
function extractSpotifyId (url) {
  if (!url) return null
  const match = url.match(/\/([A-Za-z0-9]+)$/)
  return match ? match[1] : null
}

/**
 * Checks whether all 5 album streaming link fields are populated.
 * @param {object} album
 * @returns {boolean}
 */
function hasAllAlbumLinks (album) {
  const sl = album.streamingLinks || {}
  return !!(sl.spotify && sl.appleMusic && sl.deezer && sl.tidal && sl.amazonMusic)
}

/**
 * Checks whether all supported artist streaming link fields are populated.
 * @param {object} artist
 * @returns {boolean}
 */
function hasAllArtistLinks (artist) {
  const sl = artist.streamingLinks || {}
  return !!(sl.spotify && sl.appleMusic && sl.deezer && sl.tidal && sl.amazonMusic && sl.youtube && sl.soundcloud)
}

/**
 * Determines whether an album needs Soundcharts enrichment.
 * Albums are skipped if they already have a soundchartsUuid AND all 5 streaming links.
 * Albums are flagged if they are new (no soundchartsUuid) or changed (title/track count differs).
 * @param {object} album - current album from cache
 * @param {object|null} prevAlbum - previous version of album (for change detection), or null if new
 * @returns {boolean} true if album needs SC enrichment
 */
function albumNeedsSCEnrichment (album) {
  // No UUID → needs enrichment (new or never enriched)
  if (!album.soundchartsUuid) return true
  // Has UUID and was already fully processed → skip
  // (soundchartsEnriched flag means identifiers were already fetched;
  // missing links at this point are genuinely unavailable on Soundcharts)
  if (album.soundchartsEnriched) return false
  // Has UUID but never completed identifiers fetch → needs enrichment
  return true
}

/**
 * Checks if an album has changed (title or track count differs from previous).
 * @param {object} album
 * @param {object} prevAlbum
 * @returns {boolean}
 */
function albumHasChanged (album, prevAlbum) {
  if (!prevAlbum) return true // new album
  if (album.title !== prevAlbum.title) return true
  const trackCount = (album.tracks || []).length
  const prevTrackCount = (prevAlbum.tracks || []).length
  if (trackCount !== prevTrackCount) return true
  return false
}

/**
 * Deduplicates albums by UPC, keeping the first occurrence.
 * Albums without a UPC are always kept.
 * @param {Array} albums
 * @returns {Array} deduplicated albums
 */
/**
 * Generates a Bandcamp-style slug from a title.
 * Bandcamp drops apostrophes entirely (Heart's → hearts), unlike toSlug which replaces with hyphens.
 * @param {string} title
 * @returns {string}
 */
function toBandcampSlug (title) {
  if (!title) return ''
  return title.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[''ʼ`]/g, '') // drop apostrophes
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Makes an HTTP HEAD request to check if a URL exists.
 * @param {string} url
 * @returns {Promise<number>} HTTP status code (0 on error)
 */
function headRequest (url) {
  return new Promise(resolve => {
    const protocol = url.startsWith('https') ? https : http
    const req = protocol.request(url, { method: 'HEAD' }, res => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', () => resolve(0))
    req.setTimeout(5000, () => { req.destroy(); resolve(0) })
    req.end()
  })
}

/**
 * For Spotify-only albums (no Bandcamp URL), tries to find them on Bandcamp
 * by constructing URLs from the title slug and verifying with HEAD requests.
 * @param {object} artist - artist object from cache
 * @returns {Promise<number>} number of albums matched
 */
async function verifyBandcampUrls (artist) {
  const noUrl = artist.albums.filter(a => !a.url)
  if (noUrl.length === 0) return 0

  // Find the Bandcamp base domain from existing albums
  const bcAlbum = artist.albums.find(a => {
    if (!a.url) return false
    try {
      const host = new URL(a.url).hostname
      return host === 'bandcamp.com' || host.endsWith('.bandcamp.com')
    } catch { return false }
  })
  if (!bcAlbum) return 0
  let bcBase
  try { bcBase = new URL(bcAlbum.url).origin } catch { return 0 }

  let matched = 0
  for (const album of noUrl) {
    const slug = toBandcampSlug(album.title)
    if (!slug) continue

    await delay(400)
    let status = await headRequest(`${bcBase}/album/${slug}`)
    if (status === 200) {
      album.url = `${bcBase}/album/${slug}`
      matched++
      console.log(`    ✓ BC verified: "${album.title}" → ${album.url}`)
      try {
        await delay(300)
        const info = await bandcamp.getAlbumInfo(album.url)
        if (info) {
          if (info.raw) album.raw = info.raw
          if (info.tracks && info.tracks.length) album.tracks = info.tracks
          if (info.tags && info.tags.length) album.tags = info.tags
          if (info.imageUrl) album.imageUrl = info.imageUrl
        }
      } catch (err) {
        console.warn(`    ⚠ Could not scrape album data: ${err.message}`)
      }
      continue
    }

    // Try track URL
    await delay(300)
    status = await headRequest(`${bcBase}/track/${slug}`)
    if (status === 200) {
      album.url = `${bcBase}/track/${slug}`
      matched++
      console.log(`    ✓ BC verified (track): "${album.title}" → ${album.url}`)
      try {
        await delay(300)
        const info = await bandcamp.getAlbumInfo(album.url)
        if (info) {
          if (info.raw) album.raw = info.raw
          if (info.tracks && info.tracks.length) album.tracks = info.tracks
          if (info.tags && info.tags.length) album.tags = info.tags
          if (info.imageUrl) album.imageUrl = info.imageUrl
        }
      } catch (err) {
        console.warn(`    ⚠ Could not scrape track data: ${err.message}`)
      }
    }
  }
  return matched
}

function deduplicateAlbumsByUpc (albums) {
  const seenUpcs = new Set()
  const result = []
  for (const album of albums) {
    if (album.upc) {
      if (seenUpcs.has(album.upc)) {
        console.log(`    ⚠ Duplicate UPC ${album.upc}: "${album.title}" — skipping (keeping first occurrence)`)
        continue
      }
      seenUpcs.add(album.upc)
    }
    result.push(album)
  }
  return result
}

/**
 * Filters out Spotify-only albums that belong to other labels.
 * Only applies when OTHER_LABEL_CONTENT is not set (default behavior).
 * Albums with a Bandcamp URL are always kept (they were scraped from the user's page).
 * Albums without a labelName are kept (no data to filter on).
 *
 * @param {Array} albums - artist's album list
 * @param {string[]} ownLabelNames - lowercased label names considered "own"
 * @returns {{ kept: Array, removed: number }}
 */
function filterSpotifyOnlyByLabel (albums, ownLabelNames) {
  if (!ownLabelNames || ownLabelNames.length === 0) return { kept: albums, removed: 0 }
  let removed = 0
  const kept = albums.filter(album => {
    // Always keep albums with a Bandcamp URL (scraped from user's page)
    if (album.url) return true
    // Keep albums without label info (can't filter)
    if (!album.labelName) return true
    // Keep upcoming/pre-order albums
    if (album.upcoming) return true
    // Check if any of the album's labels match our own
    const albumLabels = album.labelName.toLowerCase().split('/').map(s => s.trim())
    const isOwn = albumLabels.some(al => ownLabelNames.some(own => al.includes(own) || own.includes(al)))
    if (!isOwn) {
      console.log(`    – Filtered (other label "${album.labelName}"): "${album.title}"`)
      removed++
    }
    return isOwn
  })
  return { kept, removed }
}

/**
 * Checks quota after a Soundcharts API call.
 * Logs warnings/errors and returns whether SC calls should continue.
 * @param {boolean} isFirstCall - whether this is the first SC call of the run
 * @param {object} state - mutable state object { firstQuotaLogged, quotaExhausted }
 * @returns {boolean} true if SC calls should stop
 */
function checkQuota (isFirstCall, state) {
  const quota = getQuotaRemaining()
  if (quota == null) return false

  // Log after first call
  if (isFirstCall && !state.firstQuotaLogged) {
    console.log(`  [soundcharts] Quota remaining (start): ${quota}`)
    state.firstQuotaLogged = true
  }

  // Warn below 100
  if (quota < 100 && quota > 0) {
    console.warn(`  ⚠ [soundcharts] Low quota remaining: ${quota}`)
  }

  // Stop at 0
  if (quota <= 0) {
    if (!state.quotaExhausted) {
      console.error('  ✖ [soundcharts] Monthly quota exhausted (0 credits remaining). Soundcharts free tier resets on the 1st of each month. Continuing with gap-fill and Discogs only.')
      state.quotaExhausted = true
    }
    return true
  }

  return false
}

/**
 * Runs Soundcharts enrichment for a single artist and their albums.
 * Steps: artist resolution → artist identifiers → per-album metadata → per-album identifiers
 *
 * @param {object} artist - artist object from cache (mutated in place)
 * @param {object} config - artist config from artists.json
 * @param {string} appId - Soundcharts app ID
 * @param {string} apiKey - Soundcharts API key
 * @param {object} quotaState - mutable quota tracking state
 * @returns {Promise<void>}
 */
async function soundchartsEnrichArtist (artist, config, appId, apiKey, quotaState) {
  // ── Artist Resolution ─────────────────────────────────────────────────────
  if (!artist.soundchartsUuid) {
    const spotifyUrl = config.spotifyArtistUrl || (artist.streamingLinks && artist.streamingLinks.spotify)
    const spotifyId = extractSpotifyId(spotifyUrl)
    if (spotifyId) {
      if (quotaState.quotaExhausted) {
        console.log('  [soundcharts] Quota exhausted — skipping artist resolution')
      } else {
        const scArtist = await withRateLimit('soundcharts', () => getArtistBySpotifyId(spotifyId, appId, apiKey), artist.name)
        const isFirst = quotaState.callCount === 0
        quotaState.callCount++
        if (checkQuota(isFirst, quotaState)) { /* quota exhausted, continue with gap-fill */ }
        if (scArtist) {
          artist.soundchartsUuid = scArtist.uuid
          console.log(`  ✓ Soundcharts artist: ${scArtist.name} (${scArtist.uuid})`)
        } else {
          console.warn(`  ⚠ Soundcharts: artist not found for Spotify ID ${spotifyId}`)
        }
      }
    } else {
      console.warn('  ⚠ Soundcharts: no Spotify URL configured — skipping artist resolution')
    }
  } else {
    console.log(`  ✓ Soundcharts artist UUID cached: ${artist.soundchartsUuid}`)
  }

  // ── Artist Identifiers ────────────────────────────────────────────────────
  if (artist.soundchartsUuid && !hasAllArtistLinks(artist)) {
    if (quotaState.quotaExhausted) {
      console.log('  [soundcharts] Quota exhausted — skipping artist identifiers')
    } else {
      const links = await withRateLimit('soundcharts', () => getArtistIdentifiers(artist.soundchartsUuid, appId, apiKey), artist.name)
      quotaState.callCount++
      if (checkQuota(false, quotaState)) { /* quota exhausted */ }
      if (links) {
        const categorized = categorizeLinks(links)

        // Streaming links — fill missing only
        artist.streamingLinks = artist.streamingLinks || {}
        let filled = 0
        for (const [key, url] of Object.entries(categorized.streamingLinks)) {
          if (!artist.streamingLinks[key]) {
            artist.streamingLinks[key] = url
            filled++
          }
        }
        if (filled > 0) console.log(`  ✓ Soundcharts artist identifiers: filled ${filled} streaming link(s)`)

        // Social links — merge from both Soundcharts and bandLinks into artist.socialLinks
        artist.socialLinks = artist.socialLinks || {}

        // First, extract social links from bandLinks (Bandcamp-sourced)
        const bandLinkMap = {
          facebook: 'facebook',
          instagram: 'instagram',
          tiktok: 'tiktok',
          'x.com': 'twitter',
          twitter: 'twitter',
          'linktr.ee': 'linktree'
        }
        for (const bl of (artist.bandLinks || [])) {
          const blName = (bl.name || '').toLowerCase()
          const socialKey = bandLinkMap[blName]
          if (socialKey && !artist.socialLinks[socialKey]) {
            artist.socialLinks[socialKey] = bl.url
          }
        }

        // Then fill remaining from Soundcharts
        let socialFilled = 0
        for (const [key, url] of Object.entries(categorized.socialLinks)) {
          if (!artist.socialLinks[key]) {
            artist.socialLinks[key] = url
            socialFilled++
          }
        }
        if (socialFilled > 0) console.log(`  ✓ Soundcharts social links: filled ${socialFilled} link(s)`)

        // Discovery links — fill missing
        artist.discoveryLinks = artist.discoveryLinks || {}
        let discoveryFilled = 0
        for (const [key, url] of Object.entries(categorized.discoveryLinks)) {
          if (!artist.discoveryLinks[key]) {
            artist.discoveryLinks[key] = url
            discoveryFilled++
          }
        }
        if (discoveryFilled > 0) console.log(`  ✓ Soundcharts discovery links: filled ${discoveryFilled} link(s)`)

        // Event links — fill missing
        artist.eventLinks = artist.eventLinks || {}
        let eventFilled = 0
        for (const [key, url] of Object.entries(categorized.eventLinks)) {
          if (!artist.eventLinks[key]) {
            artist.eventLinks[key] = url
            eventFilled++
          }
        }
        if (eventFilled > 0) console.log(`  ✓ Soundcharts event links: filled ${eventFilled} link(s)`)
      }
    }
  } else if (artist.soundchartsUuid) {
    console.log('  ✓ Artist links already populated — skipping identifiers')
  }

  // ── Always merge bandLinks social platforms into artist.socialLinks ────────
  // This runs regardless of whether SC identifiers were fetched, so that
  // bandLinks from Bandcamp (Facebook, Instagram, etc.) are always available
  // in the unified socialLinks object for the template.
  {
    artist.socialLinks = artist.socialLinks || {}
    const bandLinkMap = {
      facebook: 'facebook',
      instagram: 'instagram',
      tiktok: 'tiktok',
      'x.com': 'twitter',
      twitter: 'twitter',
      'linktr.ee': 'linktree'
    }
    for (const bl of (artist.bandLinks || [])) {
      const blName = (bl.name || '').toLowerCase()
      const socialKey = bandLinkMap[blName]
      if (socialKey && !artist.socialLinks[socialKey]) {
        artist.socialLinks[socialKey] = bl.url
      }
    }
  }

  // ── Artist Events (always refresh — time-sensitive) ───────────────────────
  if (artist.soundchartsUuid) {
    if (quotaState.quotaExhausted) {
      console.log('  [soundcharts] Quota exhausted — skipping events fetch')
    } else {
      const today = new Date().toISOString().slice(0, 10)
      const events = await withRateLimit('soundcharts', () => getArtistEvents(artist.soundchartsUuid, appId, apiKey, today), artist.name)
      quotaState.callCount++
      if (checkQuota(false, quotaState)) { /* quota exhausted */ }
      artist.events = events
      if (events.length > 0) {
        console.log(`  ✓ Soundcharts events: ${events.length} upcoming event(s)`)
      } else {
        console.log('  – No upcoming events found')
      }
    }
  }

  // ── Per-Album Processing ──────────────────────────────────────────────────
  const albums = artist.albums || []

  // Dedup by UPC
  const dedupedAlbums = deduplicateAlbumsByUpc(albums)
  if (dedupedAlbums.length < albums.length) {
    artist.albums = dedupedAlbums
  }

  // Classify albums: skip vs queue
  let skippedCount = 0
  let queuedCount = 0
  const albumsToEnrich = []
  for (const album of dedupedAlbums) {
    if (!albumNeedsSCEnrichment(album)) {
      skippedCount++
    } else {
      queuedCount++
      albumsToEnrich.push(album)
    }
  }
  console.log(`  [soundcharts] Albums: ${queuedCount} queued, ${skippedCount} skipped (already enriched)`)

  for (const album of albumsToEnrich) {
    if (quotaState.quotaExhausted) {
      console.log(`  [soundcharts] Quota exhausted — skipping remaining albums`)
      break
    }

    // ── Album Metadata ────────────────────────────────────────────────────
    if (!album.soundchartsUuid) {
      const spotifyAlbumUrl = album.streamingLinks && album.streamingLinks.spotify
      const spotifyAlbumId = extractSpotifyId(spotifyAlbumUrl)
      let scAlbum = null

      if (spotifyAlbumId) {
        scAlbum = await withRateLimit('soundcharts', () => getAlbumBySpotifyId(spotifyAlbumId, appId, apiKey), album.title)
        quotaState.callCount++
        if (checkQuota(false, quotaState)) { /* quota exhausted */ }
      }

      // Fallback to UPC if no Spotify URL or Spotify lookup failed
      if (!scAlbum && album.upc) {
        if (!quotaState.quotaExhausted) {
          scAlbum = await withRateLimit('soundcharts', () => getAlbumByUpc(album.upc, appId, apiKey), album.title)
          quotaState.callCount++
          if (checkQuota(false, quotaState)) { /* quota exhausted */ }
        }
      }

      if (scAlbum) {
        album.soundchartsUuid = scAlbum.uuid
        if (scAlbum.distributor) album.distributor = scAlbum.distributor
        if (scAlbum.copyright) album.copyright = scAlbum.copyright
        if (scAlbum.upc && !album.upc) album.upc = scAlbum.upc
        if (!album.labelName && scAlbum.labels && scAlbum.labels.length > 0) {
          album.labelName = scAlbum.labels[0].name
        }
        console.log(`    ✓ SC album: "${album.title}" (${scAlbum.uuid})`)
      } else {
        console.log(`    – SC album not found: "${album.title}"`)
      }
    }

    // ── Album Identifiers ─────────────────────────────────────────────────
    if (album.soundchartsUuid && !hasAllAlbumLinks(album)) {
      if (!quotaState.quotaExhausted) {
        const links = await withRateLimit('soundcharts', () => getAlbumIdentifiers(album.soundchartsUuid, appId, apiKey), album.title)
        quotaState.callCount++
        if (checkQuota(false, quotaState)) { /* quota exhausted */ }
        if (links) {
          album.streamingLinks = album.streamingLinks || {}
          let filled = 0
          for (const [key, url] of Object.entries(links)) {
            if (!album.streamingLinks[key]) {
              album.streamingLinks[key] = url
              filled++
            }
          }
          if (filled > 0) console.log(`    ✓ SC identifiers: "${album.title}" — filled ${filled} link(s)`)
        }
        album.soundchartsEnriched = true
      }
    } else if (album.soundchartsUuid) {
      album.soundchartsEnriched = true
    }
  }
}

/**
 * For artists with a Spotify URL configured, rebuilds the album list using
 * Spotify as the source of truth. Bandcamp data (URL, albumId, artwork, tracks,
 * tags) is merged in where titles match. Unmatched Bandcamp albums are dropped.
 * Unmatched Spotify albums are added as new entries.
 *
 * @param {Array} spotifyAlbums - from fetchArtistAlbums
 * @param {Array} bandcampAlbums - current artist.albums from cache
 * @returns {Array} new album list
 */

/**
 * Lightweight link-only matching: assigns Spotify URLs to existing Bandcamp albums.
 * Does NOT add new albums, does NOT fetch UPC/metadata, does NOT modify album list structure.
 * Used for first-run enrichment where we only need streaming links.
 *
 * Title matching uses Unicode normalization, strips brackets/suffixes, and handles
 * common variations (feat., remix, single, EP suffixes).
 *
 * @param {Array} spotifyAlbumLinks - from fetchArtistAlbumLinks [{title, spotifyUrl, albumType, releaseDate}]
 * @param {Array} bandcampAlbums - current artist.albums from cache
 * @returns {{matched: number, unmatched: string[]}} stats
 */
function matchSpotifyLinksToAlbums (spotifyAlbumLinks, bandcampAlbums) {
  // Robust normalisation: Unicode NFD + strip diacritics + strip zero-width + lowercase + strip non-alnum
  const normalise = s => (s || '')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '') // zero-width chars
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // diacritics
    .toLowerCase()
    .replace(/\s*\[\d{2,4}\]\s*/g, ' ') // strip [23], [2023] year suffixes
    .replace(/\s*\(single\s*(version)?\)\s*/gi, '') // strip (Single Version)
    .replace(/\s*[-–—]\s*single\s*$/i, '') // strip "- Single" suffix
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '')

  // Build lookup from Spotify albums
  const spotifyByNorm = new Map()
  for (const sa of spotifyAlbumLinks) {
    const key = normalise(sa.title)
    if (!spotifyByNorm.has(key)) spotifyByNorm.set(key, sa)
  }

  let matched = 0
  const unmatched = []

  for (const album of bandcampAlbums) {
    // Skip if already has Spotify link
    if (album.streamingLinks && album.streamingLinks.spotify) {
      matched++
      continue
    }

    const bcNorm = normalise(album.title)
    const sa = spotifyByNorm.get(bcNorm)

    if (sa) {
      album.streamingLinks = album.streamingLinks || {}
      album.streamingLinks.spotify = sa.spotifyUrl
      if (sa.releaseDate && !album.releaseDate) {
        album.releaseDate = sa.releaseDate
      }
      matched++
      console.log(`    ✓ Link: "${album.title}" → ${sa.spotifyUrl}`)
      // Remove from map so it's not matched again (handles duplicates)
      spotifyByNorm.delete(bcNorm)
    } else {
      unmatched.push(album.title)
    }
  }

  return { matched, unmatched }
}

function buildAlbumListFromSpotify (spotifyAlbums, bandcampAlbums, artistName) {
  const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const { toSlug } = require('./slugs')

  function candidates (title) {
    const set = new Set([title])
    const noCommaSuffix = title.replace(/,\s*[^,()]+$/, '').trim()
    if (noCommaSuffix) set.add(noCommaSuffix)
    const noParen = title.replace(/\s*\([^)]*\)\s*.*$/, '').trim()
    if (noParen) set.add(noParen)
    const noFeat = title.replace(/\s+(feat\.|ft\.|featuring)\s+.*/i, '').trim()
    if (noFeat) set.add(noFeat)
    const noFeatNoComma = noFeat.replace(/,\s*[^,()]+$/, '').trim()
    if (noFeatNoComma) set.add(noFeatNoComma)
    const noSingleInParen = title.replace(/,\s*(single|album|ep)\s*\)/gi, ')').trim()
    if (noSingleInParen !== title) set.add(noSingleInParen)
    const noSingleInParenNoParen = noSingleInParen.replace(/\s*\([^)]*\)\s*.*$/, '').trim()
    if (noSingleInParenNoParen) set.add(noSingleInParenNoParen)
    const noRemixSuffix = title.replace(/\s*[-–—]\s*(remix|remixed|mix)\s*(version|edit)?\s*$/i, '').trim()
    if (noRemixSuffix !== title) set.add(noRemixSuffix)
    return [...set]
  }

  const result = []
  const usedBandcamp = new Set()

  for (const sa of spotifyAlbums) {
    const sNorm = normalise(sa.title)
    const sType = sa.albumType

    function typeMatches (ba) {
      const bcType = (ba.itemType || '').toLowerCase()
      if (!sType) return true
      if (sType === 'album') return bcType === 'album' || bcType === ''
      if (sType === 'single') return bcType === 'track' || bcType === 'single'
      if (sType === 'ep') return bcType === 'album' || bcType === 'ep' || bcType === ''
      return true
    }

    let bcMatch = bandcampAlbums.find(ba =>
      !usedBandcamp.has(ba) && normalise(ba.title) === sNorm && typeMatches(ba)
    )
    if (!bcMatch) {
      bcMatch = bandcampAlbums.find(ba => !usedBandcamp.has(ba) && normalise(ba.title) === sNorm)
    }
    if (!bcMatch) {
      bcMatch = bandcampAlbums.find(ba => {
        if (usedBandcamp.has(ba)) return false
        const cands = candidates(ba.title).map(normalise).slice(1)
        return cands.some(c => c === sNorm) && typeMatches(ba)
      })
    }
    if (!bcMatch) {
      bcMatch = bandcampAlbums.find(ba => {
        if (usedBandcamp.has(ba)) return false
        const cands = candidates(ba.title).map(normalise).slice(1)
        return cands.some(c => c === sNorm)
      })
    }
    if (!bcMatch && sa.upc) {
      bcMatch = bandcampAlbums.find(ba => !usedBandcamp.has(ba) && ba.upc && ba.upc === sa.upc)
      if (bcMatch) {
        console.log(`    ✓ UPC match: "${bcMatch.title}" → "${sa.title}" (UPC: ${sa.upc})`)
      }
    }

    if (bcMatch) {
      usedBandcamp.add(bcMatch)
      let releaseDate = bcMatch.releaseDate
      if (!releaseDate && bcMatch.raw) {
        const cur = bcMatch.raw.current
        const rawDate = (cur && cur.release_date) || bcMatch.raw.album_release_date || (cur && cur.new_date)
        if (rawDate) releaseDate = normalizeDate(rawDate)
      }
      // Spotify release date is authoritative — use it when available
      const finalReleaseDate = normalizeDate(sa.releaseDate) || normalizeDate(releaseDate) || null
      const merged = {
        ...bcMatch,
        title: sa.title,
        streamingLinks: { ...(bcMatch.streamingLinks || {}), spotify: sa.spotifyUrl },
        upc: sa.upc || bcMatch.upc || null,
        slug: toSlug(sa.title),
        releaseDate: finalReleaseDate,
        artwork: bcMatch.artwork || bcMatch.imageUrl || null
      }
      result.push(merged)
      console.log(`    ✓ Matched: "${bcMatch.title}" → "${sa.title}"${sa.upc ? ` (UPC: ${sa.upc})` : ''}`)
    } else {
      result.push({
        url: null,
        title: sa.title,
        artist: null,
        artwork: null,
        tracks: [],
        tags: [],
        albumId: null,
        itemType: sa.albumType === 'single' ? 'track' : 'album',
        releaseDate: normalizeDate(sa.releaseDate) || null,
        description: null,
        credits: null,
        streamingLinks: { spotify: sa.spotifyUrl },
        upc: sa.upc || null,
        labelName: sa.label || null,
        slug: toSlug(sa.title)
      })
      console.log(`    + Spotify-only: "${sa.title}"${sa.upc ? ` (UPC: ${sa.upc})` : ''}`)
    }
  }

  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const resultTitles = new Set(result.map(a => normalise(a.title)))
  for (const ba of bandcampAlbums) {
    if (usedBandcamp.has(ba)) continue
    if (ba.artist && norm(ba.artist) !== 'various' && norm(ba.artist) !== norm(artistName)) {
      console.log(`    – Skipped (wrong artist "${ba.artist}"): "${ba.title}"`)
      continue
    }
    const cands = candidates(ba.title).map(normalise)
    if (!cands.some(c => resultTitles.has(c))) {
      result.push({ ...ba, slug: toSlug(ba.title) })
      if (ba.url) {
        console.log(`    ↩ Kept Bandcamp-only: "${ba.title}"`)
      } else {
        console.log(`    ↩ Kept (no Spotify match): "${ba.title}"`)
      }
    }
  }

  return result
}

/**
 * Enrichment pipeline:
 *
 * Soundcharts mode (when SOUNDCHARTS_APP_ID + SOUNDCHARTS_API_KEY set):
 *   1. Soundcharts → artist resolution, identifiers, album metadata, album identifiers
 *   2. Gap-fill    → iTunes/Deezer/Tidal/MusicFetch for albums still missing links (NO Spotify)
 *   3. Discogs     → labels, physical formats (unchanged)
 *
 * Legacy mode (no Soundcharts credentials):
 *   1. Spotify   → Spotify URL + UPC (via artist page config or name search)
 *   2. iTunes    → Apple Music URL
 *   3. Deezer    → Deezer URL
 *   4. Tidal     → Tidal URL
 *   5. MusicFetch → Amazon/etc.
 *   6. Discogs   → labels, physical formats
 *
 * @param {string} cachePath
 * @param {string} [contentDir]
 * @param {object} [options] - { tidalOnly, artistFilter, refresh }
 */
async function enrichCache (cachePath, contentDir = './content', options = {}) {
  const data = await readCache(cachePath)
  if (!data) {
    console.warn('[enricher] No cache found — run without --enrich first to build it.')
    return
  }

  // ── Soundcharts credential detection (Task 3.1) ──────────────────────────
  const scAppId = (process.env.SOUNDCHARTS_APP_ID || '').trim()
  const scApiKey = (process.env.SOUNDCHARTS_API_KEY || '').trim()
  const hasSoundcharts = !!(scAppId && scApiKey)

  const spotifyClientId = (process.env.SPOTIFY_CLIENT_ID || '').trim()
  const spotifyClientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim()
  const hasSpotify = !!(spotifyClientId && spotifyClientSecret)

  const tidalClientId = (process.env.TIDAL_CLIENT_ID || '').trim()
  const tidalClientSecret = (process.env.TIDAL_CLIENT_SECRET || '').trim()
  const hasTidal = !!(tidalClientId && tidalClientSecret)

  const musicFetchKey = (process.env.MUSICFETCH_RAPIDAPI_KEY || '').trim()
  const hasMusicFetch = musicFetchKey.length > 0

  const discogsToken = (process.env.DISCOGS_TOKEN || '').trim()
  const hasDiscogs = discogsToken.length > 0

  const artistConfig = await loadArtistConfig(contentDir)

  // ── v5 config loading (config-driven links + write-back) ──────────────────
  const v5Config = await loadConfig(contentDir).catch(() => null)
  let configDirty = false // track whether config needs write-back at end

  // Log active mode — pre-check SC quota with a single lightweight call (no retries)
  let scAvailable = hasSoundcharts && !options.tidalOnly
  if (scAvailable) {
    console.log('  ✓ Soundcharts credentials detected — checking quota...')
    resetCallCount()
    // Single call to check quota header — no retry on 429
    let preCheckResult = null
    try {
      preCheckResult = await scGet('/api/v2.9/artist/by-platform/spotify/0000000000000000000000', scAppId, scApiKey)
    } catch { /* ignore */ }
    const quota = getQuotaRemaining()

    if (preCheckResult && preCheckResult.statusCode === 429 && (quota === null || quota > 0)) {
      // Rate-limited but quota not exhausted — SC is temporarily unavailable
      console.warn('  ⚠ Soundcharts rate limited on pre-check. Falling back to legacy mode for this run.')
      scAvailable = false
      resetCallCount()
    } else if (quota !== null && quota <= 0) {
      console.warn('  ⚠ Soundcharts monthly quota exhausted (0 credits). Falling back to legacy mode.')
      console.warn('  ⚠ Quota resets on the 1st of each month.')
      scAvailable = false
      resetCallCount()
    } else {
      console.log(`  ✓ Soundcharts mode active (quota: ${quota !== null ? quota : 'unknown'})`)
    }
  }
  if (!scAvailable && !options.tidalOnly) {
    console.log('  → Legacy mode (Spotify + per-platform lookups)')
    if (!hasSpotify) console.log('  (No SPOTIFY_CLIENT_ID/SECRET — skipping Spotify)')
    if (!hasTidal)   console.log('  (No TIDAL_CLIENT_ID/SECRET — skipping Tidal)')
    if (hasMusicFetch) console.log('  (MusicFetch active — will fill remaining gaps)')
  } else if (options.tidalOnly) {
    console.log('  → Tidal-only mode')
  }

  // ── Artist filter (Task 6.2) ──────────────────────────────────────────────
  let artists = data.artists || []
  if (options.artistFilter) {
    const filterSlug = toSlug(options.artistFilter)
    const filterLower = options.artistFilter.toLowerCase()
    const matched = artists.filter(a => {
      const aSlug = toSlug(a.name)
      return aSlug === filterSlug || a.name.toLowerCase() === filterLower
    })
    if (matched.length === 0) {
      console.error(`[enricher] No artist matching "${options.artistFilter}" found in cache — aborting.`)
      return
    }
    artists = matched
    console.log(`  → Filtering to artist: ${artists[0].name}`)
  }

  // ── Refresh support (Task 6.3) ────────────────────────────────────────────
  if (options.refresh && options.artistFilter) {
    for (const artist of artists) {
      console.log(`  ↻ Forced re-enrichment: clearing Soundcharts UUIDs for "${artist.name}"`)
      delete artist.soundchartsUuid
      for (const album of artist.albums || []) {
        delete album.soundchartsUuid
        delete album.soundchartsEnriched
        delete album.discogsChecked
        delete album.enrichmentChecked
      }
    }
  }

  // Quota tracking state (Task 4)
  const quotaState = { firstQuotaLogged: false, quotaExhausted: false, callCount: 0 }

  // Fallback state — tracks mid-run service disablement
  const fallbackState = {
    soundchartsDisabled: false,
    spotifyDisabled: false,
    spotifyRetryAfter: null
  }

  // Gap-fill call counting (Task 3.8)
  const gapFillCounts = { itunes: 0, deezer: 0, tidal: 0, musicfetch: 0 }

  let spotifyToken = null
  if (hasSpotify) {
    try { spotifyToken = await getAccessToken(spotifyClientId, spotifyClientSecret) }
    catch (err) { console.warn(`  [spotify] Auth failed: ${err.message}`) }
  }

  // ── Label content filter (LSG-124) ────────────────────────────────────────
  // When OTHER_LABEL_CONTENT is not set or false (default), Spotify-only albums
  // from other labels are filtered out after enrichment. This prevents artists
  // who share a name with a major-label act from polluting the site.
  const includeOtherLabelContent = (process.env.OTHER_LABEL_CONTENT || '').toLowerCase() === 'true'
  const siteMode = process.env.SITE_MODE || ''
  const siteName = (process.env.SITE_NAME || process.env.LABEL_NAME || '').trim()
  const extraLabelNames = (process.env.LABEL_ALIASES || process.env.EXTRA_LABEL_NAMES || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const ownLabelNames = [siteName.toLowerCase(), ...extraLabelNames].filter(Boolean)

  const totalArtists = artists.length
  const labelUrlCache = {} // shared across artists — avoids duplicate Discogs label lookups
  const sellListingCache = {} // shared across artists — releaseId → boolean (has active listings)

  // ── Batch limit on first enrichment (v5) ──────────────────────────────────
  const allAlbumsFlat = artists.reduce((acc, a) => acc.concat(a.albums || []), [])
  const totalAlbums = allAlbumsFlat.length
  const unenrichedCount = allAlbumsFlat.filter(a => !a.streamingLinks || Object.keys(a.streamingLinks).length === 0).length
  const isFirstRun = totalAlbums > 0 && unenrichedCount > totalAlbums * 0.8
  const batchLimit = isFirstRun ? 50 : Infinity
  let batchProcessed = 0
  if (isFirstRun) {
    console.log(`  → First enrichment detected (${unenrichedCount}/${totalAlbums} unenriched). Batch limit: ${batchLimit} albums.`)
  }

  /**
   * Backfills ISRCs from Spotify into cache tracks that are missing them.
   * Matches by track position (trackNumber) or normalized title.
   */
  async function backfillIsrcs (artist, token) {
    const albums = (artist.albums || []).filter(al =>
      al.streamingLinks && al.streamingLinks.spotify &&
      !al.upcoming &&
      (al.tracks || []).some(t => !t.isrc)
    )
    if (albums.length === 0) return

    // Normalize title for matching: lowercase, strip non-alphanumeric
    const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    // Extract base title: strip remix/version/instrumental suffixes and featured artist info
    const baseTitle = s => (s || '')
      .replace(/\s*[-–—]\s*(remix|instrumental|radio edit|extended|remaster|feat\.?|ft\.?).*$/i, '')
      .replace(/\s*\(.*?(remix|instrumental|radio edit|extended|remaster|feat\.?|ft\.?).*?\)\s*/gi, '')
      .trim()

    let totalFilled = 0
    for (const album of albums) {
      try {
        const spotifyTracks = await withRateLimit('spotify', () => fetchAlbumTrackIsrcs(token, album.streamingLinks.spotify), album.title)
        if (!spotifyTracks || spotifyTracks.length === 0) continue
        let filled = 0
        const usedSpotifyIndices = new Set()
        for (const [cacheIdx, cacheTrack] of (album.tracks || []).entries()) {
          if (cacheTrack.isrc) continue
          // 1. Match by track number
          const byNum = cacheTrack.track_num
            ? spotifyTracks.find((st, i) => !usedSpotifyIndices.has(i) && st.trackNumber === cacheTrack.track_num)
            : null
          // 2. Exact normalized title match
          const cacheNorm = norm(cacheTrack.name)
          const byExact = !byNum ? spotifyTracks.find((st, i) => !usedSpotifyIndices.has(i) && norm(st.name) === cacheNorm) : null
          // 3. Base title match (strip remix/version suffixes)
          const cacheBase = norm(baseTitle(cacheTrack.name))
          const byBase = (!byNum && !byExact && cacheBase.length >= 4)
            ? spotifyTracks.find((st, i) => !usedSpotifyIndices.has(i) && norm(baseTitle(st.name)) === cacheBase)
            : null
          // 4. Position fallback: same index if track counts match
          const byPos = (!byNum && !byExact && !byBase && album.tracks.length === spotifyTracks.length)
            ? spotifyTracks[cacheIdx]
            : null
          const match = byNum || byExact || byBase || byPos
          if (match && match.isrc) {
            const matchIdx = spotifyTracks.indexOf(match)
            usedSpotifyIndices.add(matchIdx)
            cacheTrack.isrc = match.isrc
            if (!cacheTrack.track_num && match.trackNumber) cacheTrack.track_num = match.trackNumber
            filled++
          }
        }
        if (filled > 0) {
          console.log(`    ✓ ISRCs backfilled: "${album.title}" (${filled}/${album.tracks.length} tracks)`)
          totalFilled += filled
        }
      } catch (err) {
        if (err.statusCode === 429) throw err
        console.warn(`    ⚠ ISRC fetch failed for "${album.title}": ${err.message}`)
      }
    }
    if (totalFilled > 0) console.log(`  ✓ Total ISRCs backfilled: ${totalFilled}`)
  }

  for (let artistIndex = 0; artistIndex < artists.length; artistIndex++) {
    const artist = artists[artistIndex]
    console.log(`\n[${artistIndex + 1}/${totalArtists}] ${artist.name}`)
    const slug = toSlug(artist.name)
    const config = artistConfig[slug] || {}

    // ── v5 config-driven links: read Spotify URL from config.json ──────────
    const v5ArtistConfig = v5Config && v5Config.artists && v5Config.artists[slug]
    const configSpotifyUrl = v5ArtistConfig && v5ArtistConfig.links && v5ArtistConfig.links.spotify

    if (configSpotifyUrl && !config.spotifyArtistUrl) {
      // Use config.json Spotify URL — no search needed
      config.spotifyArtistUrl = configSpotifyUrl
      console.log(`  Using Spotify URL from config for "${artist.name}"`)
    }
    // Skip enrichment for Various Artists / compilations — only gap-fill and Discogs
    const isCompilationArtist = artist.name.toLowerCase() === 'various artists' || artist.name.toLowerCase() === 'various'
    if (isCompilationArtist) {
      console.log('  → Compilation artist — applying compilations.json, then gap-fill + Discogs')
      // Apply compilations.json — direct Spotify ID mapping for compilations
      let compilationConfig = {}
      try {
        const raw = await fs.readFile(path.join(contentDir, 'compilations.json'), 'utf8')
        compilationConfig = JSON.parse(raw)
      } catch { /* no compilations.json */ }
      for (const album of artist.albums || []) {
        const key = album.slug || toSlug(album.title)
        const cfg = compilationConfig[key]
        if (cfg) {
          if (cfg.spotifyUrl) {
            album.streamingLinks = album.streamingLinks || {}
            if (!album.streamingLinks.spotify) {
              album.streamingLinks.spotify = cfg.spotifyUrl
              console.log(`    ✓ Compilation Spotify (config): "${album.title}" → ${cfg.spotifyUrl}`)
            }
          }
          if (cfg.upc && !album.upc) {
            album.upc = cfg.upc
            console.log(`    ✓ Compilation UPC (config): "${album.title}" → ${cfg.upc}`)
          }
        }
      }
      // Fetch Spotify metadata for compilations that have Spotify URLs
      if (hasSpotify && spotifyToken) {
        const needsMeta = (artist.albums || []).filter(al =>
          al.streamingLinks && al.streamingLinks.spotify && !al.spotifyLabel
        )
        if (needsMeta.length > 0) {
          try { spotifyToken = await getAccessToken(spotifyClientId, spotifyClientSecret) } catch { /* keep existing */ }
          await enrichSpotifyOnlyAlbums(needsMeta, spotifyToken)
        }
      }
    }

    // Determine if SC is available for this artist (may have been disabled mid-run)
    let useScForThisArtist = scAvailable && !fallbackState.soundchartsDisabled && !isCompilationArtist

    // ══════════════════════════════════════════════════════════════════════════
    // SOUNDCHARTS MODE
    // ══════════════════════════════════════════════════════════════════════════
    if (useScForThisArtist) {

      // ── Step 1: Spotify album list (source of truth for album catalog) ────
      if (hasSpotify && spotifyToken) {
        // Artist-level Spotify URL
        if (!(artist.streamingLinks && artist.streamingLinks.spotify)) {
          if (config.spotifyArtistUrl) {
            artist.streamingLinks = artist.streamingLinks || {}
            artist.streamingLinks.spotify = config.spotifyArtistUrl
          }
        }

        const artistSpotifyUrl = config.spotifyArtistUrl ||
          (artist.streamingLinks && artist.streamingLinks.spotify)

        // ── v5 write-back: save discovered Spotify URL to config.json ──────
        if (v5Config && v5ArtistConfig && artistSpotifyUrl && !configSpotifyUrl) {
          if (!v5ArtistConfig.links) v5ArtistConfig.links = {}
          if (!v5ArtistConfig.links.spotify) {
            v5ArtistConfig.links.spotify = artistSpotifyUrl
            configDirty = true
            console.log(`  ✓ Saved Spotify URL to config.json for "${artist.name}"`)
          }
        }

        // Fetch artist image from Spotify if not already stored
        if (artistSpotifyUrl && spotifyToken && !artist._spotifyImageUrl) {
          try {
            const imgUrl = await withRateLimit('spotify', () => getArtistImageUrl(spotifyToken, artistSpotifyUrl), artist.name)
            if (imgUrl) {
              artist._spotifyImageUrl = imgUrl
            }
          } catch { /* non-fatal */ }
        }

        if (artistSpotifyUrl && artistSpotifyUrl.includes('/artist/')) {
          try { spotifyToken = await getAccessToken(spotifyClientId, spotifyClientSecret) } catch { /* keep existing */ }
          console.log('  → Spotify album list (source of truth)...')
          try {
            const spotifyAlbums = await withRateLimit('spotify', () => fetchArtistAlbums(spotifyToken, artistSpotifyUrl), artist.name)
            if (spotifyAlbums && spotifyAlbums.length > 0) {
              artist.albums = buildAlbumListFromSpotify(spotifyAlbums, artist.albums, artist.name)
            }

            // Early label filter: remove Spotify-only albums from other labels
            // before expensive metadata/ISRC/gap-fill calls (saves API calls)
            if (!includeOtherLabelContent && siteMode !== 'artist' && ownLabelNames.length > 0 && !isCompilationArtist) {
              const { kept, removed } = filterSpotifyOnlyByLabel(artist.albums || [], ownLabelNames)
              if (removed > 0) {
                artist.albums = kept
                console.log(`  → Filtered ${removed} Spotify-only album(s) from other labels (early)`)
              }
            }

            // Fallback: searchAlbum for Bandcamp albums that didn't match any Spotify album
            const unmatchedBc = (artist.albums || []).filter(a =>
              a.url && (!a.streamingLinks || !a.streamingLinks.spotify) && albumBelongsToArtist(a, artist.name)
            )
            if (unmatchedBc.length > 0) {
              console.log(`  → Spotify search fallback for ${unmatchedBc.length} unmatched album(s)...`)
              let found = 0
              for (const album of unmatchedBc) {
                try {
                  const result = await withRateLimit('spotify', () => searchAlbumSpotify(spotifyToken, artist.name, album.title, album.itemType || (album.raw && album.raw.item_type)), album.title)
                  if (result) {
                    album.streamingLinks = album.streamingLinks || {}
                    album.streamingLinks.spotify = result.spotifyUrl
                    if (result.upc && !album.upc) album.upc = result.upc
                    found++
                    console.log(`    ✓ Search match: "${album.title}" → ${result.spotifyUrl}`)
                  }
                } catch (err) {
                  if (err.statusCode === 429) throw err // propagate rate limit
                  console.warn(`    ⚠ Search failed for "${album.title}": ${err.message}`)
                }
              }
              if (found > 0) console.log(`  ✓ Found ${found} album(s) via search fallback`)
            }
          } catch (spotifyErr) {
            if (spotifyErr.statusCode === 429 || (spotifyErr.message && spotifyErr.message.includes('429'))) {
              fallbackState.spotifyDisabled = true
              fallbackState.spotifyRetryAfter = spotifyErr.retryAfter || null
              const hours = spotifyErr.retryAfter ? Math.ceil(spotifyErr.retryAfter / 3600) : '?'
              console.warn(`  ⚠ [fallback] Spotify rate limited (429). Retry in ~${hours}h. Disabling Spotify for remaining artists.`)
            if (options.artistFilter) {
              console.error('\n[enricher] Aborting — Spotify rate limited and running in single-artist mode. Try again later.')
              await writeCache(cachePath, data)
              return
            }
            } else {
              console.warn(`  ⚠ [spotify] Album list fetch failed: ${spotifyErr.message}`)
            }
          }
        }
      }

      // ── Step 1b: Verify Bandcamp URLs for Spotify-only albums ──────────────
      const noUrlCount = (artist.albums || []).filter(a => !a.url).length
      if (noUrlCount > 0) {
        console.log(`  → Bandcamp URL verification for ${noUrlCount} Spotify-only album(s)...`)
        const found = await verifyBandcampUrls(artist)
        if (found > 0) console.log(`  ✓ Found ${found} album(s) on Bandcamp`)
      }

      // ── Step 1c: Backfill ISRCs from Spotify track data ───────────────────
      if (hasSpotify && spotifyToken && !fallbackState.spotifyDisabled) {
        try {
          try { spotifyToken = await getAccessToken(spotifyClientId, spotifyClientSecret) } catch { /* keep existing */ }
          await backfillIsrcs(artist, spotifyToken)
        } catch (err) {
          if (err.statusCode === 429) {
            fallbackState.spotifyDisabled = true
            console.warn('  ⚠ Spotify rate limited during ISRC backfill. Disabling Spotify.')
            if (options.artistFilter) {
              console.error('\n[enricher] Aborting — Spotify rate limited and running in single-artist mode. Try again later.')
              await writeCache(cachePath, data)
              return
            }
          }
        }
      }

      // ── Step 2: Soundcharts enrichment (artist + albums) ──────────────────
      await soundchartsEnrichArtist(artist, config, scAppId, scApiKey, quotaState)

      // ── Mid-artist fallback: if SC quota exhausted during this artist, switch now ──
      if (quotaState.quotaExhausted && !fallbackState.soundchartsDisabled) {
        fallbackState.soundchartsDisabled = true
        useScForThisArtist = false
        console.warn(`\n  ⚠ [fallback] Soundcharts quota exhausted mid-run during "${artist.name}".`)
        console.warn('  ⚠ [fallback] Switching to legacy enrichment (Spotify + per-platform) for remaining artists.')
        console.warn('  ⚠ [fallback] Soundcharts quota resets on the 1st of each month.')

        // Run Spotify metadata/artwork for this artist since SC couldn't finish
        if (hasSpotify && spotifyToken && !fallbackState.spotifyDisabled) {
          try {
            // Spotify-only album metadata
            const spotifyOnly = (artist.albums || []).filter(al => !al.url && al.streamingLinks && al.streamingLinks.spotify)
            if (spotifyOnly.length > 0) {
              console.log(`  → Spotify metadata for ${spotifyOnly.length} Spotify-only album(s) (fallback)...`)
              await enrichSpotifyOnlyAlbums(spotifyOnly, spotifyToken)
            }
            // Artwork for Bandcamp albums missing it
            const missingArtwork = (artist.albums || []).filter(al => al.url && !al.artwork && al.streamingLinks && al.streamingLinks.spotify)
            if (missingArtwork.length > 0) {
              console.log(`  → Fetching artwork from Spotify for ${missingArtwork.length} album(s) (fallback)...`)
              await enrichSpotifyOnlyAlbums(missingArtwork, spotifyToken)
            }
            // Spotify name search for albums still missing Spotify links
            const stillMissingSpotify = (artist.albums || []).filter(al => !(al.streamingLinks && al.streamingLinks.spotify))
            if (stillMissingSpotify.length > 0) {
              console.log(`  → Spotify name search for ${stillMissingSpotify.length} album(s) (fallback)...`)
              await enrichAlbumsWithSpotify(stillMissingSpotify, artist.name, spotifyClientId, spotifyClientSecret)
            }
          } catch (spotifyErr) {
            if (spotifyErr.statusCode === 429 || spotifyErr.status === 429 || (spotifyErr.message && spotifyErr.message.includes('429'))) {
              const retryAfter = spotifyErr.retryAfter || spotifyErr.headers && spotifyErr.headers['retry-after']
              fallbackState.spotifyDisabled = true
              fallbackState.spotifyRetryAfter = retryAfter || null
              const retryMsg = retryAfter ? ` (retry after ${retryAfter}s)` : ''
              console.warn(`  ⚠ [fallback] Spotify rate limited (429)${retryMsg}. Disabling Spotify for remaining artists.`)
              if (options.artistFilter) {
                console.error('\n[enricher] Aborting — Spotify rate limited and running in single-artist mode. Try again later.')
                await writeCache(cachePath, data)
                return
              }
            } else {
              console.warn(`  ⚠ [spotify] Error: ${spotifyErr.message}`)
            }
          }
        }
      }

      // ── Gap-fill: iTunes/Deezer/Tidal/MusicFetch for albums still missing links ──
      // NO Spotify calls in Soundcharts mode (Task 3.7)

      // ── Label content filter (LSG-125) ──────────────────────────────────────
      if (!includeOtherLabelContent && siteMode !== 'artist' && ownLabelNames.length > 0 && !isCompilationArtist) {
        const { kept, removed } = filterSpotifyOnlyByLabel(artist.albums || [], ownLabelNames)
        if (removed > 0) {
          artist.albums = kept
          console.log(`  → Filtered ${removed} album(s) from other labels`)
        }
      }

      const albums = artist.albums || []
      const needsGapFill = albums.filter(al =>
        !al.upcoming &&
        // Skip Bandcamp-only albums with no Spotify/UPC — nothing to search with
        (al.upc || (al.streamingLinks && al.streamingLinks.spotify)) &&
        (
          (!(al.streamingLinks && al.streamingLinks.appleMusic) && !(al.enrichmentChecked && al.enrichmentChecked.appleMusic)) ||
          (!(al.streamingLinks && al.streamingLinks.deezer) && !(al.enrichmentChecked && al.enrichmentChecked.deezer)) ||
          (hasTidal && !(al.streamingLinks && al.streamingLinks.tidal) && !(al.enrichmentChecked && al.enrichmentChecked.tidal)) ||
          (hasMusicFetch && !(al.streamingLinks && al.streamingLinks.amazonMusic) && !(al.enrichmentChecked && al.enrichmentChecked.amazonMusic))
        )
      )

      if (needsGapFill.length > 0) {
        console.log(`  → Gap-fill: ${needsGapFill.length} album(s) via iTunes/Deezer/Tidal/MusicFetch...`)
        let scGapProcessed = 0
        const scGapTotal = needsGapFill.length

        await pMap(needsGapFill, 3, async (album) => {
          scGapProcessed++
          console.log(`  Enriching ${scGapProcessed}/${scGapTotal} — ${album.title}...`)

          // Check batch limit
          batchProcessed++
          if (batchProcessed > batchLimit) return

          const tasks = []

          if (!(album.streamingLinks && album.streamingLinks.appleMusic) && !(album.enrichmentChecked && album.enrichmentChecked.appleMusic)) {
            tasks.push(
              (async () => {
                const { lookupByUpc, searchAlbum } = require('./itunes')
                let result = await searchAlbum(artist.name, album.title)
                if (!result && album.upc) result = await lookupByUpc(album.upc)
                if (result) {
                  album.streamingLinks = album.streamingLinks || {}
                  album.streamingLinks.appleMusic = result.albumUrl
                  if (result.artistUrl && !(artist.streamingLinks && artist.streamingLinks.appleMusic)) {
                    artist.streamingLinks = artist.streamingLinks || {}
                    artist.streamingLinks.appleMusic = result.artistUrl
                  }
                  console.log(`    ✓ iTunes (gap-fill): "${album.title}"`)
                  gapFillCounts.itunes++
                } else {
                  album.enrichmentChecked = album.enrichmentChecked || {}
                  album.enrichmentChecked.appleMusic = true
                }
              })()
            )
          }

          if (!(album.streamingLinks && album.streamingLinks.deezer) && !(album.enrichmentChecked && album.enrichmentChecked.deezer)) {
            tasks.push(
              (async () => {
                const { lookupByUpc, searchAlbum } = require('./deezer')
                let result = await searchAlbum(artist.name, album.title)
                if (!result && album.upc) result = await lookupByUpc(album.upc)
                if (result) {
                  album.streamingLinks = album.streamingLinks || {}
                  album.streamingLinks.deezer = result.albumUrl
                  if (result.artistUrl && !(artist.streamingLinks && artist.streamingLinks.deezer)) {
                    artist.streamingLinks = artist.streamingLinks || {}
                    artist.streamingLinks.deezer = result.artistUrl
                  }
                  console.log(`    ✓ Deezer (gap-fill): "${album.title}"`)
                  gapFillCounts.deezer++
                } else {
                  album.enrichmentChecked = album.enrichmentChecked || {}
                  album.enrichmentChecked.deezer = true
                }
              })()
            )
          }

          if (hasTidal && !(album.streamingLinks && album.streamingLinks.tidal) && !(album.enrichmentChecked && album.enrichmentChecked.tidal)) {
            tasks.push(
              (async () => {
                const { lookupByUpc, searchAlbum, getAccessToken } = require('./tidal')
                let token
                try { token = await getAccessToken(tidalClientId, tidalClientSecret) } catch { return }
                if (!token) return
                let result = null
                if (album.upc) result = await lookupByUpc(token, album.upc, album.title)
                if (!result) result = await searchAlbum(token, artist.name, album.title)
                if (result) {
                  album.streamingLinks = album.streamingLinks || {}
                  album.streamingLinks.tidal = result.albumUrl
                  console.log(`    ✓ Tidal (gap-fill): "${album.title}"`)
                  gapFillCounts.tidal++
                  if (result.artistId && !(artist.streamingLinks && artist.streamingLinks.tidal)) {
                    artist.streamingLinks = artist.streamingLinks || {}
                    artist.streamingLinks.tidal = `https://tidal.com/browse/artist/${result.artistId}`
                  }
                } else {
                  album.enrichmentChecked = album.enrichmentChecked || {}
                  album.enrichmentChecked.tidal = true
                }
              })()
            )
          }

          if (hasMusicFetch && !(album.streamingLinks && album.streamingLinks.amazonMusic) && !(album.enrichmentChecked && album.enrichmentChecked.amazonMusic)) {
            tasks.push(
              (async () => {
                const { fetchLinksByUpc, fetchLinksByUrl } = require('./musicfetch')
                const upc = album.upc
                const spotifyUrl = album.streamingLinks && album.streamingLinks.spotify
                if (!upc && !spotifyUrl) return
                const links = upc
                  ? await fetchLinksByUpc(musicFetchKey, upc)
                  : await fetchLinksByUrl(musicFetchKey, spotifyUrl)
                if (links) {
                  const existing = album.streamingLinks || {}
                  album.streamingLinks = { ...links, ...existing }
                  console.log(`    ✓ MusicFetch (gap-fill): "${album.title}" → ${Object.keys(links).join(', ')}`)
                  gapFillCounts.musicfetch++
                } else {
                  album.enrichmentChecked = album.enrichmentChecked || {}
                  album.enrichmentChecked.amazonMusic = true
                }
              })()
            )
          }

          await Promise.all(tasks)
        })
      }

      // Artist-level MusicFetch (needs Spotify artist URL)
      if (hasMusicFetch) {
        await enrichArtistWithMusicFetch(artist, musicFetchKey)
      }

    } else if (!options.tidalOnly) {
      // ════════════════════════════════════════════════════════════════════════
      // LEGACY MODE (no Soundcharts credentials, or SC disabled mid-run)
      // ════════════════════════════════════════════════════════════════════════

      if (fallbackState.soundchartsDisabled && scAvailable) {
        console.log('  → Soundcharts disabled mid-run, using legacy enrichment path')
      }

      // ── Step 1: Spotify (lightweight — links only, no metadata) ──────────────
      if (hasSpotify && spotifyToken && !fallbackState.spotifyDisabled && !isCompilationArtist) {
        try {

        // 1a. Resolve artist Spotify URL (from config or search)
        let artistSpotifyUrl = config.spotifyArtistUrl ||
          (artist.streamingLinks && artist.streamingLinks.spotify)

        if (!artistSpotifyUrl) {
          const { searchArtist } = require('./spotify')
          await delay(600)
          const foundUrl = await searchArtist(spotifyToken, artist.name)
          if (foundUrl) {
            artist.streamingLinks = artist.streamingLinks || {}
            artist.streamingLinks.spotify = foundUrl
            artistSpotifyUrl = foundUrl
            console.log(`  ✓ Spotify artist: ${foundUrl}`)
          } else {
            console.log(`  ✗ No Spotify artist found for "${artist.name}"`)
          }
        }

        // v5 write-back: save discovered Spotify URL to config.json
        if (v5Config && v5ArtistConfig && artistSpotifyUrl && !configSpotifyUrl) {
          if (!v5ArtistConfig.links) v5ArtistConfig.links = {}
          if (!v5ArtistConfig.links.spotify) {
            v5ArtistConfig.links.spotify = artistSpotifyUrl
            configDirty = true
            console.log(`  ✓ Saved Spotify URL to config.json`)
          }
        }

        // 1b. Fetch artist image from Spotify if no local photo
        if (artistSpotifyUrl && !artist._spotifyImageUrl) {
          try {
            await delay(600)
            const imgUrl = await getArtistImageUrl(spotifyToken, artistSpotifyUrl)
            if (imgUrl) artist._spotifyImageUrl = imgUrl
          } catch { /* non-fatal */ }
        }

        // 1c. Fetch album links (lightweight — only titles + URLs, no UPC/label)
        if (artistSpotifyUrl && artistSpotifyUrl.includes('/artist/')) {
          console.log(`  → Fetching Spotify album links...`)
          const spotifyAlbumLinks = await fetchArtistAlbumLinks(spotifyToken, artistSpotifyUrl)

          if (spotifyAlbumLinks && spotifyAlbumLinks.length > 0) {
            // Match Spotify links to existing Bandcamp albums (no new albums added)
            const { matched, unmatched } = matchSpotifyLinksToAlbums(spotifyAlbumLinks, artist.albums || [])
            console.log(`  ✓ Matched ${matched} album(s), ${unmatched.length} without Spotify match`)
            if (unmatched.length > 0 && unmatched.length <= 5) {
              for (const t of unmatched) console.log(`    · No match: "${t}"`)
            }
          } else {
            console.log(`  ✗ No albums found on Spotify artist page`)
          }
        }

        } catch (spotifyErr) {
          if (spotifyErr.statusCode === 429 || spotifyErr.status === 429 || (spotifyErr.message && spotifyErr.message.includes('429'))) {
            const retryAfter = spotifyErr.retryAfter || (spotifyErr.headers && spotifyErr.headers['retry-after'])
            const waitSec = retryAfter ? Math.max(parseInt(retryAfter, 10) || 60, 60) : 60
            console.warn(`  ⚠ Spotify rate limited (429). Global pause ${waitSec}s...`)
            console.warn(`  ⚠ Tip: Configure Soundcharts for reliable enrichment without rate limits. See API-SETUP.md.`)
            await delay(waitSec * 1000)
          } else {
            console.warn(`  ⚠ [spotify] Error: ${spotifyErr.message}`)
          }
        }
      }

      // ── UPC from Spotify (only with --force, Spotify UPC is source of truth) ──
      // Normal enrich: UPC comes from Bandcamp scrape or CSV (0 API calls).
      // Force mode: Fetch authoritative UPC from Spotify (1 call per album, risk of 429).
      if (options.refresh && hasSpotify && spotifyToken && !isCompilationArtist) {
        const albumsWithSpotifyLink = (artist.albums || []).filter(al =>
          al.streamingLinks && al.streamingLinks.spotify && !al.upcoming
        )
        const albumsNeedingUpc = albumsWithSpotifyLink.filter(al => !al.upc)
        if (albumsNeedingUpc.length > 0) {
          console.log(`  → Fetching UPC from Spotify for ${albumsNeedingUpc.length} album(s) (--force)...`)
          const { getAlbumUpcBySpotifyUrl } = require('./spotify')
          let upcFetched = 0
          let rateLimited = false
          for (const album of albumsNeedingUpc) {
            try {
              await delay(1000)
              const result = await getAlbumUpcBySpotifyUrl(spotifyToken, album.streamingLinks.spotify)
              if (result && result.upc) {
                album.upc = result.upc
                if (result.label && !album.labelName) album.labelName = result.label
                upcFetched++
              }
            } catch (err) {
              if (err.statusCode === 429) {
                rateLimited = true
                console.warn(`\n  ⚠ Spotify rate limited (429) during UPC fetch.`)
                console.warn(`  ${upcFetched} of ${albumsNeedingUpc.length} UPCs fetched before limit.`)
                console.warn(`  Run --enrich --force again later to continue, or configure Soundcharts for reliable UPC.`)
                break
              }
            }
          }
          if (upcFetched > 0 && !rateLimited) console.log(`  ✓ Fetched ${upcFetched} UPC(s) from Spotify`)
        }
      }

      // ── Steps 2–4+6: iTunes, Deezer, Tidal, MusicFetch ─────────────────────

      // ── Label content filter (LSG-125) ──────────────────────────────────────
      if (!includeOtherLabelContent && siteMode !== 'artist' && ownLabelNames.length > 0 && !isCompilationArtist) {
        const { kept, removed } = filterSpotifyOnlyByLabel(artist.albums || [], ownLabelNames)
        if (removed > 0) {
          artist.albums = kept
          console.log(`  → Filtered ${removed} album(s) from other labels`)
        }
      }

      const albums = artist.albums || []
      const needsEnrichment = albums.filter(al =>
        !al.upcoming &&
        // Skip Bandcamp-only albums with no Spotify/UPC — nothing to search with
        (al.upc || (al.streamingLinks && al.streamingLinks.spotify)) &&
        (
          (!(al.streamingLinks && al.streamingLinks.appleMusic) && !(al.enrichmentChecked && al.enrichmentChecked.appleMusic)) ||
          (!(al.streamingLinks && al.streamingLinks.deezer) && !(al.enrichmentChecked && al.enrichmentChecked.deezer)) ||
          (hasTidal && !(al.streamingLinks && al.streamingLinks.tidal) && !(al.enrichmentChecked && al.enrichmentChecked.tidal)) ||
          (hasMusicFetch && !(al.streamingLinks && al.streamingLinks.amazonMusic) && !(al.enrichmentChecked && al.enrichmentChecked.amazonMusic))
        )
      )

      if (needsEnrichment.length > 0) {
        console.log(`  → Enriching ${needsEnrichment.length} album(s) via iTunes/Deezer/Tidal/MusicFetch concurrently...`)
        let legacyProcessed = 0
        const legacyTotal = needsEnrichment.length

        await pMap(needsEnrichment, 3, async (album) => {
          legacyProcessed++
          console.log(`  Enriching ${legacyProcessed}/${legacyTotal} — ${album.title}...`)

          // Check batch limit
          batchProcessed++
          if (batchProcessed > batchLimit) return

          const tasks = []

          if (!(album.streamingLinks && album.streamingLinks.appleMusic) && !(album.enrichmentChecked && album.enrichmentChecked.appleMusic)) {
            tasks.push(
              (async () => {
                const { lookupByUpc, searchAlbum } = require('./itunes')
                let result = await searchAlbum(artist.name, album.title)
                if (!result && album.upc) result = await lookupByUpc(album.upc)
                if (result) {
                  album.streamingLinks = album.streamingLinks || {}
                  album.streamingLinks.appleMusic = result.albumUrl
                  if (result.artistUrl && !(artist.streamingLinks && artist.streamingLinks.appleMusic)) {
                    artist.streamingLinks = artist.streamingLinks || {}
                    artist.streamingLinks.appleMusic = result.artistUrl
                  }
                  console.log(`    ✓ iTunes: "${album.title}"`)
                } else {
                  album.enrichmentChecked = album.enrichmentChecked || {}
                  album.enrichmentChecked.appleMusic = true
                }
              })()
            )
          }

          if (!(album.streamingLinks && album.streamingLinks.deezer) && !(album.enrichmentChecked && album.enrichmentChecked.deezer)) {
            tasks.push(
              (async () => {
                const { lookupByUpc, searchAlbum } = require('./deezer')
                let result = await searchAlbum(artist.name, album.title)
                if (!result && album.upc) result = await lookupByUpc(album.upc)
                if (result) {
                  album.streamingLinks = album.streamingLinks || {}
                  album.streamingLinks.deezer = result.albumUrl
                  if (result.artistUrl && !(artist.streamingLinks && artist.streamingLinks.deezer)) {
                    artist.streamingLinks = artist.streamingLinks || {}
                    artist.streamingLinks.deezer = result.artistUrl
                  }
                  console.log(`    ✓ Deezer: "${album.title}"`)
                } else {
                  album.enrichmentChecked = album.enrichmentChecked || {}
                  album.enrichmentChecked.deezer = true
                }
              })()
            )
          }

          if (hasTidal && !(album.streamingLinks && album.streamingLinks.tidal) && !(album.enrichmentChecked && album.enrichmentChecked.tidal)) {
            tasks.push(
              (async () => {
                const { lookupByUpc, searchAlbum, getAccessToken } = require('./tidal')
                let token
                try { token = await getAccessToken(tidalClientId, tidalClientSecret) } catch { return }
                if (!token) return
                let result = null
                if (album.upc) result = await lookupByUpc(token, album.upc, album.title)
                if (!result) result = await searchAlbum(token, artist.name, album.title)
                if (result) {
                  album.streamingLinks = album.streamingLinks || {}
                  album.streamingLinks.tidal = result.albumUrl
                  console.log(`    ✓ Tidal: "${album.title}"`)
                  if (result.artistId && !(artist.streamingLinks && artist.streamingLinks.tidal)) {
                    artist.streamingLinks = artist.streamingLinks || {}
                    artist.streamingLinks.tidal = `https://tidal.com/browse/artist/${result.artistId}`
                    console.log(`  ✓ Tidal artist (from album): "${artist.name}" → ${artist.streamingLinks.tidal}`)
                  }
                } else {
                  album.enrichmentChecked = album.enrichmentChecked || {}
                  album.enrichmentChecked.tidal = true
                }
              })()
            )
          }

          if (hasMusicFetch && !(album.streamingLinks && album.streamingLinks.amazonMusic) && !(album.enrichmentChecked && album.enrichmentChecked.amazonMusic)) {
            tasks.push(
              (async () => {
                const { fetchLinksByUpc, fetchLinksByUrl } = require('./musicfetch')
                const upc = album.upc
                const spotifyUrl = album.streamingLinks && album.streamingLinks.spotify
                if (!upc && !spotifyUrl) return
                const links = upc
                  ? await fetchLinksByUpc(musicFetchKey, upc)
                  : await fetchLinksByUrl(musicFetchKey, spotifyUrl)
                if (links) {
                  const existing = album.streamingLinks || {}
                  album.streamingLinks = { ...links, ...existing }
                  console.log(`    ✓ MusicFetch: "${album.title}" → ${Object.keys(links).join(', ')}`)
                } else {
                  album.enrichmentChecked = album.enrichmentChecked || {}
                  album.enrichmentChecked.amazonMusic = true
                }
              })()
            )
          }

          await Promise.all(tasks)
        })
      }

      // Artist-level MusicFetch (needs Spotify artist URL)
      if (hasMusicFetch) {
        await enrichArtistWithMusicFetch(artist, musicFetchKey)
      }

    } else {
      // ════════════════════════════════════════════════════════════════════════
      // TIDAL-ONLY MODE
      // ════════════════════════════════════════════════════════════════════════
      if (hasTidal || config.tidalArtistUrl) {
        if (!(artist.streamingLinks && artist.streamingLinks.tidal)) {
          if (config.tidalArtistUrl) {
            artist.streamingLinks = artist.streamingLinks || {}
            artist.streamingLinks.tidal = config.tidalArtistUrl
            console.log(`  ✓ Tidal artist (config): ${config.tidalArtistUrl}`)
          } else if (hasTidal) {
            await enrichArtistWithTidal(artist, tidalClientId, tidalClientSecret)
          }
        }
        const needsTidal = (artist.albums || []).filter(al => !(al.streamingLinks && al.streamingLinks.tidal))
        if (needsTidal.length > 0) {
          console.log(`  → Tidal for ${needsTidal.length} album(s)...`)
          await pMap(needsTidal, 3, async (album) => {
            const { lookupByUpc, searchAlbum, getAccessToken } = require('./tidal')
            let token
            try { token = await getAccessToken(tidalClientId, tidalClientSecret) } catch { return }
            if (!token) return
            let result = null
            if (album.upc) result = await lookupByUpc(token, album.upc, album.title)
            if (!result) result = await searchAlbum(token, artist.name, album.title)
            if (result) {
              album.streamingLinks = album.streamingLinks || {}
              album.streamingLinks.tidal = result.albumUrl
              console.log(`    ✓ Tidal: "${album.title}"`)
              if (result.artistId && !(artist.streamingLinks && artist.streamingLinks.tidal)) {
                artist.streamingLinks = artist.streamingLinks || {}
                artist.streamingLinks.tidal = `https://tidal.com/browse/artist/${result.artistId}`
                console.log(`  ✓ Tidal artist (from album): "${artist.name}" → ${artist.streamingLinks.tidal}`)
              }
            }
          })
        }
      }
    }

    // ── Discogs — always runs (both modes), conservative concurrency ────────
    if (hasDiscogs && !options.tidalOnly) {
      const allAlbums = artist.albums || []
      const needsDiscogs = allAlbums.filter(al => !al.discogsUrl && !al.discogsChecked && !al.upcoming)
      // Also include albums needing per-format sell link re-fetch
      const needsSellLinks = allAlbums.filter(al =>
        al.discogsUrl && !al.upcoming &&
        al.physicalFormats && al.physicalFormats.length > 1 &&
        !al.discogsSellUrlVinyl && !al.discogsSellUrlCd && !al.discogsSellUrlCassette
      )
      const discogsAlbums = [...needsDiscogs, ...needsSellLinks]
      if (discogsAlbums.length > 0) {
        const parts = []
        if (needsDiscogs.length > 0) parts.push(`${needsDiscogs.length} album(s)`)
        if (needsSellLinks.length > 0) parts.push(`${needsSellLinks.length} sell-link update(s)`)
        console.log(`  → Discogs for ${parts.join(' + ')}...`)
        await withRateLimit('discogs', () => enrichAlbumsWithDiscogs(discogsAlbums, artist.name, discogsToken), artist.name)
      }

      // ── Verify sell URLs have active listings ─────────────────────────────
      const withSellUrls = allAlbums.filter(al =>
        !al.upcoming && (al.discogsSellUrl || al.discogsSellUrlVinyl || al.discogsSellUrlCd || al.discogsSellUrlCassette)
      )
      if (withSellUrls.length > 0) {
        // Deduplicate: collect unique release IDs across all sell URLs
        let cleared = 0
        for (const album of withSellUrls) {
          const urls = [
            ['discogsSellUrlVinyl', album.discogsSellUrlVinyl],
            ['discogsSellUrlCd', album.discogsSellUrlCd],
            ['discogsSellUrlCassette', album.discogsSellUrlCassette]
          ]
          for (const [field, url] of urls) {
            if (!url) continue
            const idMatch = url.match(/\/release\/(\d+)/)
            if (!idMatch) continue
            const releaseId = idMatch[1]
            if (sellListingCache[releaseId] === undefined) {
              sellListingCache[releaseId] = await hasActiveListings(discogsToken, url)
            }
            if (!sellListingCache[releaseId]) {
              album[field] = null
              cleared++
            }
          }
          // Recalculate primary sell URL from remaining per-format URLs
          album.discogsSellUrl = album.discogsSellUrlVinyl || album.discogsSellUrlCd || album.discogsSellUrlCassette || null
        }
        if (cleared > 0) console.log(`  ✓ Cleared ${cleared} sell link(s) with no active listings`)
      }
    }

    // ── Spotify label fallback — runs when not using SC for this artist ────
    if (!useScForThisArtist && !isCompilationArtist && hasSpotify && spotifyToken && !options.tidalOnly && !fallbackState.spotifyDisabled) {
      // Fetch Spotify metadata for albums missing labels OR missing spotifyLabel (for comparison)
      const needsSpotifyLabel = (artist.albums || []).filter(al =>
        !al.spotifyLabel && al.streamingLinks && al.streamingLinks.spotify
      )
      if (needsSpotifyLabel.length > 0) {
        console.log(`  → Spotify label check for ${needsSpotifyLabel.length} album(s)...`)
        try { spotifyToken = await getAccessToken(spotifyClientId, spotifyClientSecret) } catch { /* keep existing */ }
        await enrichSpotifyOnlyAlbums(needsSpotifyLabel, spotifyToken)
      }

      // Spotify label comparison moved to dual-label resolution block below (runs for all modes)
    }

    // ── Dual-label resolution — runs for ALL modes (Soundcharts + legacy) ──
    for (const al of artist.albums || []) {
      if (al.spotifyLabel && al.labelName && al.labelName !== al.spotifyLabel) {
        const hasPhysical = al.physicalFormats && al.physicalFormats.length > 0
        if (hasPhysical && !al.discogsLabel) {
          al.discogsLabel = al.labelName
          al.discogsLabelUrls = al.labelUrls || al._discogsLabelUrls || []
          console.log(`    ✓ Dual label: "${al.title}" — digital: "${al.spotifyLabel}", physical: "${al.labelName}"`)
        }
        if (al.discogsLabel && !al.discogsLabelUrls) {
          al.discogsLabelUrls = al._discogsLabelUrls || al.labelUrls || []
        }
        al.labelName = al.spotifyLabel
      } else if (al.spotifyLabel && !al.labelName) {
        al.labelName = al.spotifyLabel
      }
      // Backfill discogsLabelUrls for entries where labelName was already overwritten
      if (al.discogsLabel && !al.discogsLabelUrls) {
        al.discogsLabelUrls = al._discogsLabelUrls || []
      }
      // Clean up temporary Discogs fields
      delete al._discogsLabelName
      delete al._discogsLabelUrls
    }

    // ── Discogs label URL lookup — resolve missing label URLs ───────────────
    if (hasDiscogs && !options.tidalOnly) {
      const labelsToLookup = new Set()
      for (const al of artist.albums || []) {
        // Check discogsLabel parts
        if (al.discogsLabel) {
          const parts = al.discogsLabel.split(' / ')
          const urls = al.discogsLabelUrls || []
          for (let i = 0; i < parts.length; i++) {
            if (!urls[i] && parts[i].trim()) labelsToLookup.add(parts[i].trim())
          }
        }
        // Check labelName parts
        if (al.labelName) {
          const parts = al.labelName.split(' / ')
          const urls = al.labelUrls || []
          for (let i = 0; i < parts.length; i++) {
            if (!urls[i] && parts[i].trim()) labelsToLookup.add(parts[i].trim())
          }
        }
      }
      if (labelsToLookup.size > 0) {
        const uncached = [...labelsToLookup].filter(name => labelUrlCache[name] === undefined)
        let resolved = 0
        for (const name of uncached) {
          const url = await lookupLabelUrl(discogsToken, name, labelUrlCache)
          if (url) resolved++
        }
        if (resolved > 0) console.log(`  ✓ Resolved ${resolved} label URL(s) via Discogs`)
        // Apply resolved URLs
        for (const al of artist.albums || []) {
          if (al.discogsLabel) {
            const parts = al.discogsLabel.split(' / ')
            const urls = al.discogsLabelUrls || new Array(parts.length).fill(null)
            let changed = false
            for (let i = 0; i < parts.length; i++) {
              if (!urls[i] && labelUrlCache[parts[i].trim()]) {
                urls[i] = labelUrlCache[parts[i].trim()]
                changed = true
              }
            }
            if (changed) al.discogsLabelUrls = urls
          }
          if (al.labelName) {
            const parts = al.labelName.split(' / ')
            const urls = al.labelUrls || new Array(parts.length).fill(null)
            let changed = false
            for (let i = 0; i < parts.length; i++) {
              if (!urls[i] && labelUrlCache[parts[i].trim()]) {
                urls[i] = labelUrlCache[parts[i].trim()]
                changed = true
              }
            }
            if (changed) {
              al.labelUrls = urls
              al.labelUrl = urls[0] || al.labelUrl
            }
          }
        }
      }
    }

    // ── Per-artist cache save (progress preservation) ───────────────────────
    await writeCache(cachePath, data)
    console.log(`  ✓ Cache saved after ${artist.name}`)
  }

  // ── End-of-run logging ──────────────────────────────────────────────────────
  if (scAvailable) {
    // Log quota remaining at end (Task 4.1)
    const endQuota = getQuotaRemaining()
    if (endQuota != null) {
      console.log(`\n[soundcharts] Quota remaining (end): ${endQuota}`)
    }
    // Log total SC call count (Task 4.2)
    console.log(`[soundcharts] Total API calls this run: ${getCallCount()}`)

    // Log gap-fill counts (Task 3.8)
    const gfParts = []
    if (gapFillCounts.itunes > 0) gfParts.push(`iTunes: ${gapFillCounts.itunes}`)
    if (gapFillCounts.deezer > 0) gfParts.push(`Deezer: ${gapFillCounts.deezer}`)
    if (gapFillCounts.tidal > 0) gfParts.push(`Tidal: ${gapFillCounts.tidal}`)
    if (gapFillCounts.musicfetch > 0) gfParts.push(`MusicFetch: ${gapFillCounts.musicfetch}`)
    if (gfParts.length > 0) {
      console.log(`[gap-fill] Calls: ${gfParts.join(', ')}`)
    } else {
      console.log('[gap-fill] No gap-fill calls needed')
    }
  }

  // ── Write discovered links back to config.json (once at end) ──────────────
  if (configDirty && v5Config) {
    try {
      await writeConfig(v5Config, contentDir)
      console.log('  ✓ config.json updated with discovered links')
    } catch (err) {
      console.warn(`  ⚠ Could not write config.json: ${err.message}`)
    }
  }

  // ── Batch limit message ─────────────────────────────────────────────────────
  if (batchProcessed >= batchLimit) {
    console.log(`\n  Batch limit reached (${batchLimit} albums). Run again to continue.`)
  }

  await writeCache(cachePath, data)
  console.log('\nEnrichment complete. Cache updated.')
}

module.exports = {
  enrichCache,
  loadArtistConfig,
  // Exported for testing
  extractSpotifyId,
  hasAllAlbumLinks,
  hasAllArtistLinks,
  albumNeedsSCEnrichment,
  albumHasChanged,
  deduplicateAlbumsByUpc,
  checkQuota
}
