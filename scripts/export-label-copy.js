'use strict'

require('dotenv').config()

const fs = require('fs')
const path = require('path')
const { getAccessToken, fetchArtistAlbums } = require('../src/spotify')
const { fetchAlbumTracks } = require('./spotifyTracks')
const { formatLabelCopy } = require('./labelCopyFormatter')
const sc = require('./soundcharts')

// ---------------------------------------------------------------------------
// Pure logic functions (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Parses process.argv-style array for --artist, --release, --output, --source flags.
 * @param {string[]} argv
 * @returns {{ artist: string|null, release: string|null, output: string|null, source: string }}
 */
function parseArgs (argv) {
  const args = argv.slice(2)
  let artist = null
  let release = null
  let output = null
  let source = 'cache' // default to cache (no API calls needed)

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--artist' && args[i + 1] !== undefined) {
      artist = args[++i]
    } else if (args[i] === '--release' && args[i + 1] !== undefined) {
      release = args[++i]
    } else if (args[i] === '--output' && args[i + 1] !== undefined) {
      output = args[++i]
    } else if (args[i] === '--source' && args[i + 1] !== undefined) {
      source = args[++i].toLowerCase()
    }
  }

  return { artist, release, output, source }
}

/**
 * Resolves the output directory based on flag value, env var, and default.
 * Precedence: flagValue > envValue > './label-copy'
 * @param {string|null|undefined} flagValue
 * @param {string|null|undefined} envValue
 * @returns {string}
 */
function resolveOutputDir (flagValue, envValue) {
  if (flagValue) return flagValue
  if (envValue) return envValue
  return './label-copy'
}

/**
 * Reads and parses artists.json from the given file path.
 * Returns empty object if file is missing or contains invalid JSON.
 * @param {string} filePath
 * @returns {Object}
 */
function loadArtistsConfig (filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/**
 * Filters artists config to those matching the given value (by slug).
 * Returns all artists if value is null/undefined.
 * @param {Object} config - artists.json object
 * @param {string|null|undefined} artistValue
 * @returns {Array<{ slug: string, spotifyArtistUrl: string }>}
 */
function filterArtists (config, artistValue) {
  const entries = Object.entries(config).map(([slug, data]) => ({
    slug,
    spotifyArtistUrl: data.spotifyArtistUrl
  }))

  if (artistValue == null) return entries

  return entries.filter(a => a.slug === artistValue)
}

/**
 * Extracts the Spotify ID from a Spotify URL.
 * e.g. https://open.spotify.com/album/6FbeljEMKV3VQP9pTExFio → 6FbeljEMKV3VQP9pTExFio
 * @param {string} spotifyUrl
 * @returns {string|null}
 */
function extractSpotifyId (spotifyUrl) {
  if (!spotifyUrl) return null
  const match = spotifyUrl.match(/\/([A-Za-z0-9]+)$/)
  return match ? match[1] : null
}

/**
 * Filters albums to those matching the given value (by title case-insensitive or Spotify ID).
 * Returns all albums if value is null/undefined.
 * @param {Array} albums
 * @param {string|null|undefined} releaseValue
 * @returns {Array}
 */
function filterAlbums (albums, releaseValue) {
  if (releaseValue == null) return albums

  const needle = releaseValue.toLowerCase()
  return albums.filter(album => {
    const titleMatch = (album.title || album.name || '').toLowerCase() === needle
    const idMatch = extractSpotifyId(album.spotifyUrl) === releaseValue
    return titleMatch || idMatch
  })
}

/**
 * Converts an ISO date string to YYYY-MM-DD format.
 * @param {string|null} isoString
 * @returns {string|null}
 */
function toYMD (isoString) {
  if (!isoString) return null
  try {
    return isoString.slice(0, 10)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Soundcharts-based pipeline
// ---------------------------------------------------------------------------

async function runSoundcharts (artists, releaseArg, outputDir) {
  const appId = process.env.SOUNDCHARTS_APP_ID
  const apiKey = process.env.SOUNDCHARTS_API_KEY

  if (!appId || !apiKey) {
    console.error('Error: Soundcharts credentials not set. Add SOUNDCHARTS_APP_ID and SOUNDCHARTS_API_KEY to your .env file.')
    console.error('For sandbox testing, use: SOUNDCHARTS_APP_ID=soundcharts SOUNDCHARTS_API_KEY=soundcharts')
    process.exit(1)
  }

  console.info(`[info] Using Soundcharts API (${appId === 'soundcharts' ? 'sandbox' : 'production'})`)

  // Load cache for fallback metadata (distributor, copyright, label, UPC, ISRCs)
  const cachePath = path.join(__dirname, '..', 'cache.json')
  let cacheData = null
  try {
    cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    console.info('[info] Cache loaded for metadata fallback')
  } catch {
    console.info('[info] No cache available — using API data only')
  }
  const { toSlug } = require('../src/slugs')

  for (const [artistIndex, artist] of artists.entries()) {
    const spotifyArtistId = extractSpotifyId(artist.spotifyArtistUrl)
    if (!spotifyArtistId) {
      console.warn(`  Warning: No Spotify URL for ${artist.slug}, skipping`)
      continue
    }

    console.info(`[info] [${artistIndex + 1}/${artists.length}] Resolving artist: ${artist.slug}`)

    const scArtist = await sc.getArtistBySpotifyId(spotifyArtistId, appId, apiKey)
    if (!scArtist) {
      console.warn(`  Warning: Artist ${artist.slug} not found in Soundcharts, skipping`)
      continue
    }
    console.info(`[info]   Resolved to: ${scArtist.name} (${scArtist.uuid})`)

    const scAlbums = await sc.getArtistAlbums(scArtist.uuid, appId, apiKey)
    console.info(`[info]   Found ${scAlbums.length} release(s) in Soundcharts`)

    // Normalize Soundcharts albums to common shape for filtering
    let albums = scAlbums.map(a => ({
      title: a.name,
      uuid: a.uuid,
      releaseDate: a.releaseDate,
      type: a.type
    }))

    if (releaseArg != null) {
      const needle = releaseArg.toLowerCase()
      albums = albums.filter(a => (a.title || '').toLowerCase() === needle)
      if (albums.length === 0) {
        console.error(`Error: Release '${releaseArg}' not found for artist '${artist.slug}'`)
        process.exit(1)
      }
    }

    console.info(`[info]   Processing ${albums.length} album(s)`)

    const albumsWithTracks = []
    for (const [albumIndex, album] of albums.entries()) {
      console.info(`[info]   [${albumIndex + 1}/${albums.length}] Fetching metadata for: ${album.title}`)

      // Get full album metadata (UPC, label, distributor, copyright)
      const albumMeta = await sc.getAlbumBySpotifyId(album.uuid, appId, apiKey)
        .catch(() => null)

      // Try to get album metadata by UUID directly if Spotify lookup fails
      let upc = null
      let label = null
      let distributor = null
      let copyright = null

      if (albumMeta) {
        upc = albumMeta.upc || null
        label = (albumMeta.labels || []).map(l => l.name).join(' / ') || null
        distributor = albumMeta.distributor || null
        copyright = albumMeta.copyright || null
      }

      // Fallback to cache for fields the API didn't return
      if (cacheData) {
        const cacheArtist = (cacheData.artists || []).find(a =>
          toSlug(a.name) === artist.slug || a.name.toLowerCase() === artist.slug.toLowerCase()
        )
        if (cacheArtist) {
          const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
          const cacheAlbum = (cacheArtist.albums || []).find(a => norm(a.title) === norm(album.title))
          if (cacheAlbum) {
            if (!upc && cacheAlbum.upc) upc = cacheAlbum.upc
            if (!label && cacheAlbum.labelName) label = cacheAlbum.labelName
            if (!distributor && cacheAlbum.distributor) distributor = cacheAlbum.distributor
            if (!copyright && cacheAlbum.copyright) copyright = cacheAlbum.copyright
          }
        }
      }

      // Get tracklisting
      const scTracks = await sc.getAlbumTracks(album.uuid, appId, apiKey)
      console.info(`[info]     → ${scTracks.length} track(s)`)

      // Enrich each track with song metadata (composers, producers, ISRC, ISWC, publishers)
      const tracks = []
      for (const [trackIndex, scTrack] of scTracks.entries()) {
        let songMeta = null
        const song = scTrack.song || {}
        const trackName = song.name || scTrack.name || scTrack.title || ''
        const trackIsrc = song.isrc || scTrack.isrc || null

        // Try ISRC lookup first, then UUID
        if (trackIsrc) {
          songMeta = await sc.getSongByIsrc(trackIsrc, appId, apiKey)
        }
        if (!songMeta && song.uuid) {
          songMeta = await sc.getSongMetadata(song.uuid, appId, apiKey)
        }

        // Resolve ISWC → Work → writers + publishers
        const iswcs = (songMeta && songMeta.iswcs) || []
        let writers = []
        let publishers = []

        if (iswcs.length > 0) {
          // Use first ISWC to look up the work (they typically point to the same work)
          const work = await sc.getWorkByIswc(iswcs[0], appId, apiKey)
          if (work) {
            writers = (work.writers || []).map(w => w.name)
            publishers = (work.publishers || []).map(p => {
              const parts = [p.name]
              if (p.share != null) parts[0] += ` (${p.share}%)`
              if (p.adminPublisher) parts.push(`admin: ${p.adminPublisher.name}`)
              return parts.join(' — ')
            })
          }
        }

        let resolvedIsrc = trackIsrc || (songMeta && songMeta.isrc && songMeta.isrc.value) || null

        // Fallback: try cache for ISRC if API didn't return one
        if (!resolvedIsrc && cacheData) {
          const cacheArtist = (cacheData.artists || []).find(a =>
            toSlug(a.name) === artist.slug || a.name.toLowerCase() === artist.slug.toLowerCase()
          )
          if (cacheArtist) {
            const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
            const cacheAlbum = (cacheArtist.albums || []).find(a => norm(a.title) === norm(album.title))
            if (cacheAlbum && cacheAlbum.tracks) {
              const cacheTrack = cacheAlbum.tracks.find(t => norm(t.name) === norm(trackName))
              if (cacheTrack && cacheTrack.isrc) resolvedIsrc = cacheTrack.isrc
            }
          }
        }

        tracks.push({
          trackNumber: scTrack.number || scTrack.trackNumber || (trackIndex + 1),
          title: trackName,
          isrc: resolvedIsrc,
          iswc: iswcs[0] || null,
          authors: writers,
          composers: (songMeta && songMeta.composers) || [],
          producers: (songMeta && songMeta.producers) || [],
          publishers
        })
      }

      const composerCount = tracks.filter(t => t.composers.length > 0).length
      const producerCount = tracks.filter(t => t.producers.length > 0).length
      const publisherCount = tracks.filter(t => t.publishers.length > 0).length
      const iswcCount = tracks.filter(t => t.iswc).length
      if (composerCount > 0 || producerCount > 0 || publisherCount > 0) {
        console.info(`[info]     → Credits: ${composerCount} with composers, ${producerCount} with producers, ${publisherCount} with publishers, ${iswcCount} with ISWC`)
      }

      albumsWithTracks.push({
        title: album.title,
        releaseDate: toYMD(album.releaseDate),
        upc,
        label,
        distributor,
        copyright,
        tracks
      })
    }

    const artistName = scArtist.name || artist.slug
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')

    const markdown = formatLabelCopy({
      name: artistName,
      slug: artist.slug,
      albums: albumsWithTracks
    })

    const outFile = path.join(outputDir, `${artist.slug}.md`)
    try {
      fs.writeFileSync(outFile, markdown, 'utf8')
      console.info(`[info]   Written: ${outFile}`)
    } catch (err) {
      console.error(`Error: Could not write file '${outFile}' — ${err.message}`)
      process.exit(1)
    }
  }
}

// ---------------------------------------------------------------------------
// Spotify-based pipeline (original)
// ---------------------------------------------------------------------------

async function runSpotify (artists, releaseArg, outputDir) {
  const clientId = process.env.LABEL_COPY_SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.LABEL_COPY_SPOTIFY_CLIENT_SECRET || process.env.SPOTIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error('Error: Spotify credentials not set. Add LABEL_COPY_SPOTIFY_CLIENT_ID and LABEL_COPY_SPOTIFY_CLIENT_SECRET (or SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET) to your .env file.')
    process.exit(1)
  }

  console.info('[info] Authenticating with Spotify...')
  let token
  try {
    token = await getAccessToken(clientId, clientSecret)
    console.info('[info] Authenticated successfully')
  } catch (err) {
    console.error(`Error: Spotify authentication failed — ${err.message}`)
    process.exit(1)
  }

  for (const [artistIndex, artist] of artists.entries()) {
    console.info(`[info] [${artistIndex + 1}/${artists.length}] Fetching albums for: ${artist.slug}`)

    let rawAlbums
    try {
      rawAlbums = await fetchArtistAlbums(token, artist.spotifyArtistUrl)
    } catch (err) {
      console.warn(`  Warning: Could not fetch albums for ${artist.slug} — ${err.message}`)
      rawAlbums = []
    }

    let albums = filterAlbums(rawAlbums, releaseArg)

    if (releaseArg != null && albums.length === 0) {
      console.error(`Error: Release '${releaseArg}' not found for artist '${artist.slug}'`)
      process.exit(1)
    }

    console.info(`[info]   Found ${albums.length} album(s)`)

    const albumsWithTracks = []
    for (const [albumIndex, album] of albums.entries()) {
      const albumId = extractSpotifyId(album.spotifyUrl)
      let tracks = []
      if (albumId) {
        console.info(`[info]   [${albumIndex + 1}/${albums.length}] Fetching tracks for: ${album.title}`)
        try {
          tracks = await fetchAlbumTracks(token, albumId)
          console.info(`[info]     → ${tracks.length} track(s), ISRC available on ${tracks.filter(t => t.isrc).length}`)
        } catch (err) {
          console.warn(`  Warning: Could not fetch tracks for '${album.title}' — ${err.message}`)
        }
      }

      albumsWithTracks.push({
        title: album.title,
        releaseDate: toYMD(album.releaseDate),
        upc: album.upc || null,
        tracks
      })
    }

    const artistName = artist.slug
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')

    const markdown = formatLabelCopy({
      name: artistName,
      slug: artist.slug,
      albums: albumsWithTracks
    })

    const outFile = path.join(outputDir, `${artist.slug}.md`)
    try {
      fs.writeFileSync(outFile, markdown, 'utf8')
      console.info(`[info]   Written: ${outFile}`)
    } catch (err) {
      console.error(`Error: Could not write file '${outFile}' — ${err.message}`)
      process.exit(1)
    }
  }

  console.info('[info] Done. Authors/Composers/Producers columns are intentionally empty — Spotify\'s public API does not expose credits data. Fill these in manually.')
}

// ---------------------------------------------------------------------------
// Cache-based pipeline (reads from cache.json, no API calls)
// ---------------------------------------------------------------------------

async function runCache (artists, releaseArg, outputDir) {
  const cachePath = path.join(__dirname, '..', 'cache.json')
  let cache
  try {
    cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
  } catch {
    console.error('Error: Could not read cache.json')
    process.exit(1)
  }

  const { toSlug } = require('../src/slugs')

  for (const [artistIndex, artistConfig] of artists.entries()) {
    const cacheArtist = (cache.artists || []).find(a => {
      const slug = toSlug(a.name)
      return slug === artistConfig.slug || a.name.toLowerCase() === artistConfig.slug.toLowerCase()
    })

    if (!cacheArtist) {
      console.warn(`  Warning: Artist '${artistConfig.slug}' not found in cache, skipping`)
      continue
    }

    console.info(`[info] [${artistIndex + 1}/${artists.length}] ${cacheArtist.name} — ${(cacheArtist.albums || []).length} album(s) in cache`)

    let albums = cacheArtist.albums || []
    if (releaseArg != null) {
      const needle = releaseArg.toLowerCase()
      albums = albums.filter(a => (a.title || '').toLowerCase() === needle)
      if (albums.length === 0) {
        console.error(`Error: Release '${releaseArg}' not found for artist '${cacheArtist.name}'`)
        process.exit(1)
      }
    }

    const albumsWithTracks = albums.map(album => ({
      title: album.title,
      releaseDate: toYMD(album.releaseDate),
      upc: album.upc || null,
      label: album.labelName || null,
      distributor: album.distributor || null,
      copyright: album.copyright || null,
      tracks: (album.tracks || []).map((track, i) => ({
        trackNumber: track.track_num || (i + 1),
        title: track.name || '',
        isrc: track.isrc || null,
        authors: [],
        composers: [],
        producers: []
      }))
    }))

    const markdown = formatLabelCopy({
      name: cacheArtist.name,
      slug: artistConfig.slug,
      albums: albumsWithTracks
    })

    const outFile = path.join(outputDir, `${artistConfig.slug}.md`)
    try {
      fs.writeFileSync(outFile, markdown, 'utf8')
      console.info(`[info]   Written: ${outFile}`)
    } catch (err) {
      console.error(`Error: Could not write file '${outFile}' — ${err.message}`)
      process.exit(1)
    }
  }

  console.info('[info] Done (from cache — no API calls used).')
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

async function main () {
  const { artist: artistArg, release: releaseArg, output: outputArg, source } = parseArgs(process.argv)
  const outputDir = resolveOutputDir(outputArg, process.env.LABEL_COPY_DIR)

  const configPath = path.join(__dirname, '..', 'content', 'artists.json')
  const config = loadArtistsConfig(configPath)

  const artists = filterArtists(config, artistArg)

  if (artistArg != null && artists.length === 0) {
    console.error(`Error: Artist '${artistArg}' not found in artists.json`)
    process.exit(1)
  }

  console.info(`[info] Output directory: ${outputDir}`)
  try {
    fs.mkdirSync(outputDir, { recursive: true })
  } catch (err) {
    console.error(`Error: Could not create output directory '${outputDir}' — ${err.message}`)
    process.exit(1)
  }

  console.info(`[info] Processing ${artists.length} artist(s)`)

  if (source === 'cache') {
    await runCache(artists, releaseArg, outputDir)
  } else if (source === 'spotify') {
    await runSpotify(artists, releaseArg, outputDir)
  } else if (source === 'soundcharts') {
    await runSoundcharts(artists, releaseArg, outputDir)
  } else {
    console.error(`Error: Unknown source '${source}'. Use --source cache, --source spotify, or --source soundcharts`)
    process.exit(1)
  }

  console.info('[info] Done.')
}

module.exports = { parseArgs, resolveOutputDir, loadArtistsConfig, filterArtists, filterAlbums }

if (require.main === module) {
  main()
}
