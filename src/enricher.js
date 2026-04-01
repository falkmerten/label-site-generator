'use strict'

const fs = require('fs/promises')
const path = require('path')
const { readCache, writeCache } = require('./cache')
const { enrichAlbumsWithSpotify, enrichArtistWithSpotify, getAccessToken, fetchArtistAlbums, enrichSpotifyOnlyAlbums } = require('./spotify')
const { enrichAlbumsWithItunes } = require('./itunes')
const { enrichAlbumsWithDeezer } = require('./deezer')
const { enrichAlbumsWithTidal, enrichArtistWithTidal } = require('./tidal')
const { enrichAlbumsWithMusicFetch, enrichArtistWithMusicFetch } = require('./musicfetch')
const { enrichAlbumsWithDiscogs } = require('./discogs')
const { toSlug } = require('./slugs')
const { extractAlbumId } = require('./merger')

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
 * Matches Spotify albums (from artist page) to cache albums by title.
 * Sets spotify URL + UPC on matched albums.
 * UPC-first: only falls back to name search for unmatched albums.
 */
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
    return [...set]
  }

  const result = []

  const usedBandcamp = new Set()

  for (const sa of spotifyAlbums) {
    const sNorm = normalise(sa.title)
    const sType = sa.albumType // 'album', 'single', 'ep'

    // Helper: does a Bandcamp album type match a Spotify album type?
    function typeMatches (ba) {
      const bcType = (ba.itemType || '').toLowerCase()
      if (!sType) return true
      if (sType === 'album') return bcType === 'album' || bcType === ''
      if (sType === 'single') return bcType === 'track' || bcType === 'single'
      if (sType === 'ep') return bcType === 'album' || bcType === 'ep' || bcType === ''
      return true
    }

    // Pass 1a: exact title + type match
    let bcMatch = bandcampAlbums.find(ba =>
      !usedBandcamp.has(ba) && normalise(ba.title) === sNorm && typeMatches(ba)
    )

    // Pass 1b: exact title match ignoring type (fallback when type doesn't match)
    if (!bcMatch) {
      bcMatch = bandcampAlbums.find(ba => !usedBandcamp.has(ba) && normalise(ba.title) === sNorm)
    }

    // Pass 2: fuzzy title match (stripped candidates) — only if no exact match found
    if (!bcMatch) {
      bcMatch = bandcampAlbums.find(ba => {
        if (usedBandcamp.has(ba)) return false
        const cands = candidates(ba.title).map(normalise).slice(1) // skip index 0 (exact, already tried)
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

    // Pass 3: match by UPC
    if (!bcMatch && sa.upc) {
      bcMatch = bandcampAlbums.find(ba => !usedBandcamp.has(ba) && ba.upc && ba.upc === sa.upc)
      if (bcMatch) {
        console.log(`    ✓ UPC match: "${bcMatch.title}" → "${sa.title}" (UPC: ${sa.upc})`)
      }
    }

    if (bcMatch) {
      usedBandcamp.add(bcMatch)
      // Compute releaseDate from raw if not already set (merger.js logic)
      let releaseDate = bcMatch.releaseDate
      if (!releaseDate && bcMatch.raw) {
        const cur = bcMatch.raw.current
        const rawDate = (cur && cur.release_date) || bcMatch.raw.album_release_date || (cur && cur.new_date)
        if (rawDate) releaseDate = new Date(rawDate).toISOString()
      }
      // Merge: use Spotify title + UPC, keep all Bandcamp data including release date
      const merged = {
        ...bcMatch,
        title: sa.title,
        streamingLinks: { ...(bcMatch.streamingLinks || {}), spotify: sa.spotifyUrl },
        upc: sa.upc || bcMatch.upc || null,
        slug: toSlug(sa.title),
        releaseDate: releaseDate || sa.releaseDate || null,
        // Preserve artwork — use imageUrl from raw scrape if artwork not already set
        artwork: bcMatch.artwork || bcMatch.imageUrl || null
      }
      result.push(merged)
      console.log(`    ✓ Matched: "${bcMatch.title}" → "${sa.title}"${sa.upc ? ` (UPC: ${sa.upc})` : ''}`)
    } else {
      // Spotify-only release — no Bandcamp data
      result.push({
        url: null,
        title: sa.title,
        artist: null,
        artwork: null,
        tracks: [],
        tags: [],
        albumId: null,
        itemType: sa.albumType === 'single' ? 'track' : 'album',
        releaseDate: sa.releaseDate || null,
        description: null,
        credits: null,
        streamingLinks: { spotify: sa.spotifyUrl },
        upc: sa.upc || null,
        slug: toSlug(sa.title)
      })
      console.log(`    + Spotify-only: "${sa.title}"${sa.upc ? ` (UPC: ${sa.upc})` : ''}`)
    }
  }

  // Keep Bandcamp-only albums that had no Spotify match — but only if they belong to this artist
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const resultTitles = new Set(result.map(a => normalise(a.title)))
  for (const ba of bandcampAlbums) {
    if (usedBandcamp.has(ba)) continue
    // Skip albums that clearly belong to a different artist
    if (ba.artist && norm(ba.artist) !== 'various' && norm(ba.artist) !== norm(artistName)) {
      console.log(`    – Skipped (wrong artist "${ba.artist}"): "${ba.title}"`)
      continue
    }
    const cands = candidates(ba.title).map(normalise)
    if (!cands.some(c => resultTitles.has(c))) {
      result.push({ ...ba, slug: toSlug(ba.title) })
      console.log(`    ↩ Kept Bandcamp-only: "${ba.title}"`)
    }
  }

  return result
}

/**
 * Enrichment pipeline:
 *
 * 1. Spotify  → Spotify URL + UPC (via artist page config or name search)
 * 2. iTunes   → Apple Music URL  (UPC lookup → title search fallback)
 * 3. Deezer   → Deezer URL       (UPC lookup → title search fallback)
 * 4. Tidal    → Tidal URL        (UPC lookup → title search fallback)
 * 5. MusicFetch → Amazon/etc.    (optional, if key set)
 *
 * UPC is always preferred. Text search is only used as a last resort.
 *
 * @param {string} cachePath
 * @param {string} [contentDir]
 */
async function enrichCache (cachePath, contentDir = './content', options = {}) {
  const data = await readCache(cachePath)
  if (!data) {
    console.warn('[enricher] No cache found — run without --enrich first to build it.')
    return
  }

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

  if (!hasSpotify) console.log('  (No SPOTIFY_CLIENT_ID/SECRET — skipping Spotify)')
  if (!hasTidal)   console.log('  (No TIDAL_CLIENT_ID/SECRET — skipping Tidal)')
  if (hasMusicFetch) console.log('  (MusicFetch active — will fill remaining gaps)')

  let spotifyToken = null
  if (hasSpotify) {
    try { spotifyToken = await getAccessToken(spotifyClientId, spotifyClientSecret) }
    catch (err) { console.warn(`  [spotify] Auth failed: ${err.message}`) }
  }

  for (const artist of data.artists || []) {
    console.log(`\n[${artist.name}]`)
    const slug = toSlug(artist.name)
    const config = artistConfig[slug] || {}

    // ── Step 1: Spotify ───────────────────────────────────────────────────────
    if (hasSpotify && spotifyToken && !options.tidalOnly) {

      // 1a. Artist-level Spotify URL
      if (!(artist.streamingLinks && artist.streamingLinks.spotify)) {
        if (config.spotifyArtistUrl) {
          artist.streamingLinks = artist.streamingLinks || {}
          artist.streamingLinks.spotify = config.spotifyArtistUrl
          console.log(`  ✓ Spotify artist (config): ${config.spotifyArtistUrl}`)
        } else {
          await enrichArtistWithSpotify(artist, spotifyClientId, spotifyClientSecret)
        }
      }

      // 1b. Album Spotify URLs + UPCs via artist page (preferred over text search)
      const artistSpotifyUrl = config.spotifyArtistUrl ||
        (artist.streamingLinks && artist.streamingLinks.spotify)

      if (artistSpotifyUrl && artistSpotifyUrl.includes('/artist/')) {
        // Refresh token before the paginated fetch to avoid expiry
        try { spotifyToken = await getAccessToken(spotifyClientId, spotifyClientSecret) } catch { /* keep existing */ }

        console.log(`  → Spotify artist page fetch (rebuilding album list)...`)
        const spotifyAlbums = await fetchArtistAlbums(spotifyToken, artistSpotifyUrl)
        if (spotifyAlbums.length > 0) {
          artist.albums = buildAlbumListFromSpotify(spotifyAlbums, artist.albums, artist.name)
        }
      }

      // 1c. Fetch full metadata from Spotify for Spotify-only albums (no Bandcamp URL)
      if (spotifyToken) {
        const spotifyOnly = (artist.albums || []).filter(al => !al.url && al.streamingLinks && al.streamingLinks.spotify)
        if (spotifyOnly.length > 0) {
          console.log(`  → Spotify metadata for ${spotifyOnly.length} Spotify-only album(s)...`)
          await enrichSpotifyOnlyAlbums(spotifyOnly, spotifyToken)
        }
      }

      // 1d. Fetch artwork from Spotify for Bandcamp albums missing artwork
      if (spotifyToken) {
        const missingArtwork = (artist.albums || []).filter(al => al.url && !al.artwork && al.streamingLinks && al.streamingLinks.spotify)
        if (missingArtwork.length > 0) {
          console.log(`  → Fetching artwork from Spotify for ${missingArtwork.length} Bandcamp album(s)...`)
          await enrichSpotifyOnlyAlbums(missingArtwork, spotifyToken)
        }
      }

      // 1d. Fall back to name search only for artists NOT in config
      // (if we have the artist URL, fetchArtistAlbums already got everything available)
      if (!config.spotifyArtistUrl) {
        const stillMissingSpotify = (artist.albums || []).filter(
          al => !(al.streamingLinks && al.streamingLinks.spotify)
        )
        if (stillMissingSpotify.length > 0) {
          console.log(`  → Spotify name search for ${stillMissingSpotify.length} album(s)...`)
          await enrichAlbumsWithSpotify(stillMissingSpotify, artist.name, spotifyClientId, spotifyClientSecret)
        }
      }
    }

    // ── Steps 2–4+6: iTunes, Deezer, Tidal, MusicFetch — run concurrently per album ──
    if (!options.tidalOnly) {
      const albums = artist.albums || []
      const needsEnrichment = albums.filter(al =>
        !(al.streamingLinks && al.streamingLinks.appleMusic) ||
        !(al.streamingLinks && al.streamingLinks.deezer) ||
        (hasTidal && !(al.streamingLinks && al.streamingLinks.tidal)) ||
        (hasMusicFetch && !(al.streamingLinks && al.streamingLinks.amazonMusic))
      )

      if (needsEnrichment.length > 0) {
        console.log(`  → Enriching ${needsEnrichment.length} album(s) via iTunes/Deezer/Tidal/MusicFetch concurrently...`)

        // Process up to 3 albums at a time; within each album run all services in parallel
        await pMap(needsEnrichment, 3, async (album) => {
          const tasks = []

          if (!(album.streamingLinks && album.streamingLinks.appleMusic)) {
            tasks.push(
              (async () => {
                const { lookupByUpc, searchAlbum } = require('./itunes')
                // Try title search first (more reliable), fall back to UPC
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
                }
              })()
            )
          }

          if (!(album.streamingLinks && album.streamingLinks.deezer)) {
            tasks.push(
              (async () => {
                const { lookupByUpc, searchAlbum } = require('./deezer')
                // Try title search first (more reliable), fall back to UPC
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
                }
              })()
            )
          }

          if (hasTidal && !(album.streamingLinks && album.streamingLinks.tidal)) {
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
                }
              })()
            )
          }

          if (hasMusicFetch && !(album.streamingLinks && album.streamingLinks.amazonMusic)) {
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
      // tidalOnly mode — just run Tidal
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

    // ── Step 5: Discogs — conservative concurrency (rate limited) ────────────
    if (hasDiscogs && !options.tidalOnly) {
      const needsDiscogs = (artist.albums || []).filter(al => !al.discogsUrl)
      if (needsDiscogs.length > 0) {
        console.log(`  → Discogs for ${needsDiscogs.length} album(s)...`)
        await enrichAlbumsWithDiscogs(needsDiscogs, artist.name, discogsToken)
      }
    }
  }

  await writeCache(cachePath, data)
  console.log('\nEnrichment complete. Cache updated.')
}

module.exports = { enrichCache }
