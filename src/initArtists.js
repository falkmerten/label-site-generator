'use strict'

const fs = require('fs/promises')
const path = require('path')
const https = require('https')
const { readCache } = require('./cache')
const { getAccessToken, searchArtist } = require('./spotify')
const { toSlug } = require('./slugs')

const DELAY_MS = 300

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Compares Bandcamp album titles against Spotify album titles.
 * Returns { matched, total, matchRatio, unmatchedBandcamp }
 */
function compareAlbums (bandcampTitles, spotifyTitles) {
  const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const normSpotify = spotifyTitles.map(normalise)
  let matched = 0
  const unmatchedBandcamp = []
  for (const title of bandcampTitles) {
    const norm = normalise(title)
    const found = normSpotify.some(s => s.includes(norm) || norm.includes(s))
    if (found) matched++
    else unmatchedBandcamp.push(title)
  }
  return {
    matched,
    total: bandcampTitles.length,
    matchRatio: bandcampTitles.length > 0 ? matched / bandcampTitles.length : 0,
    unmatchedBandcamp
  }
}

/**
 * Validates a Spotify artist URL against the artist's Bandcamp albums.
 * Returns { ok, pct, unmatchedBandcamp } or null on failure.
 * Uses a lightweight fetch (no UPC lookup) to avoid rate limiting.
 */
async function validateArtistUrl (token, spotifyArtistUrl, bandcampTitles, artistName) {
  const m = spotifyArtistUrl.match(/artist\/([A-Za-z0-9]+)/)
  if (!m) return null

  // Fetch titles only — no UPC lookup to avoid rate limiting
  const titles = await new Promise((resolve) => {
    const options = {
      hostname: 'api.spotify.com',
      path: `/v1/artists/${m[1]}/albums?include_groups=album,single&limit=10`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }
    https.get(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        if (res.statusCode === 429) {
          console.warn(`    [spotify] Rate limited — waiting 30s...`)
          setTimeout(() => resolve(null), 30000)
          return
        }
        if (res.statusCode !== 200) return resolve(null)
        try {
          const data = JSON.parse(raw)
          resolve((data.items || []).map(a => a.name))
        } catch { resolve(null) }
      })
    }).on('error', () => resolve(null))
  })
  if (!titles || titles.length === 0) {
    console.warn(`  ⚠ ${artistName} — could not fetch Spotify albums (check URL or rate limit)`)
    return null
  }

  console.log(`    Spotify albums (${titles.length}): ${titles.slice(0, 5).join(', ')}${titles.length > 5 ? '...' : ''}`)
  const { matched, total, matchRatio, unmatchedBandcamp } = compareAlbums(bandcampTitles, titles)
  const pct = Math.round(matchRatio * 100)
  return { ok: matchRatio >= 0.5, pct, matched, total, unmatchedBandcamp }
}

/**
 * Generates content/artists.json by searching Spotify for each artist in the cache.
 * - Existing entries: validated against Bandcamp albums (URL never changed)
 * - New entries: searched, validated, written (null placeholder if not found)
 *
 * @param {string} cachePath
 * @param {string} contentDir
 */
async function initArtistsConfig (cachePath, contentDir = './content') {
  const data = await readCache(cachePath)
  if (!data) {
    console.error('[init-artists] No cache found — run without flags first to build it.')
    return
  }

  const spotifyClientId = (process.env.SPOTIFY_CLIENT_ID || '').trim()
  const spotifyClientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim()
  const hasSpotify = !!(spotifyClientId && spotifyClientSecret)

  const configPath = path.join(contentDir, 'artists.json')
  let existing = {}
  try {
    existing = JSON.parse(await fs.readFile(configPath, 'utf8'))
  } catch { /* file doesn't exist yet */ }

  let token = null
  if (hasSpotify) {
    try {
      token = await getAccessToken(spotifyClientId, spotifyClientSecret)
    } catch (err) {
      console.warn(`  [spotify] Auth failed: ${err.message}`)
    }
  }

  const result = { ...existing }
  const warnings = []

  for (const artist of data.artists || []) {
    const slug = toSlug(artist.name)
    const bandcampTitles = (artist.albums || []).map(a => a.title)

    // Refresh token before each artist to avoid expiry mid-run
    if (hasSpotify) {
      try {
        token = await getAccessToken(spotifyClientId, spotifyClientSecret)
      } catch (err) {
        console.warn(`  [spotify] Token refresh failed: ${err.message}`)
        token = null
      }
    }

    // ── Existing entry: validate but never overwrite ──────────────────────────
    if (slug in existing) {
      const existingUrl = existing[slug].spotifyArtistUrl
      if (existingUrl && token) {
        const check = await validateArtistUrl(token, existingUrl, bandcampTitles, artist.name)
        if (check) {
          if (check.ok) {
            console.log(`  ✓ ${artist.name} — OK (${check.matched}/${check.total} albums, ${check.pct}%)`)
            if (check.unmatchedBandcamp.length > 0) {
              console.log(`    Unmatched on Spotify: ${check.unmatchedBandcamp.join(', ')}`)
            }
          } else {
            console.warn(`  ⚠ ${artist.name} — LOW CONFIDENCE (${check.matched}/${check.total} albums, ${check.pct}%) — please verify`)
            console.warn(`    URL: ${existingUrl}`)
            if (check.unmatchedBandcamp.length > 0) {
              console.warn(`    Unmatched Bandcamp: ${check.unmatchedBandcamp.join(', ')}`)
            }
            warnings.push(`${artist.name} (existing)`)
          }
        }
      } else {
        console.log(`  – ${artist.name} — in config (null)`)
      }
      await delay(2000)
      continue
    }

    // ── New entry: search + validate ─────────────────────────────────────────
    let spotifyArtistUrl = null
    let note = null

    if (token) {
      try {
        spotifyArtistUrl = await searchArtist(token, artist.name)
        await delay(DELAY_MS)

        if (spotifyArtistUrl) {
          const check = await validateArtistUrl(token, spotifyArtistUrl, bandcampTitles, artist.name)
          if (check) {
            if (check.ok) {
              console.log(`  ✓ ${artist.name} → ${spotifyArtistUrl} (${check.matched}/${check.total} albums, ${check.pct}%)`)
              if (check.unmatchedBandcamp.length > 0) {
                console.log(`    Unmatched on Spotify: ${check.unmatchedBandcamp.join(', ')}`)
              }
            } else {
              console.warn(`  ⚠ ${artist.name} → LOW CONFIDENCE (${check.matched}/${check.total} albums, ${check.pct}%)`)
              console.warn(`    URL: ${spotifyArtistUrl}`)
              if (check.unmatchedBandcamp.length > 0) {
                console.warn(`    Unmatched Bandcamp: ${check.unmatchedBandcamp.join(', ')}`)
              }
              note = `LOW CONFIDENCE: only ${check.pct}% album match — please verify`
              warnings.push(artist.name)
            }
          }
        }
      } catch (err) {
        console.warn(`  ⚠ ${artist.name}: ${err.message}`)
      }
    }

    if (spotifyArtistUrl) {
      result[slug] = note ? { spotifyArtistUrl, _note: note } : { spotifyArtistUrl }
    } else {
      console.log(`  – ${artist.name} → not found on Spotify (null placeholder)`)
      result[slug] = { spotifyArtistUrl: null }
    }

    await delay(2000) // pause between artists to avoid rate limiting
  }

  const sorted = Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b))
  )

  await fs.mkdir(contentDir, { recursive: true })
  await fs.writeFile(configPath, JSON.stringify(sorted, null, 2) + '\n', 'utf8')
  console.log(`\nWrote ${configPath}`)

  if (warnings.length > 0) {
    console.warn(`\n⚠ Low-confidence matches needing review: ${warnings.join(', ')}`)
  }
  console.log('Review the file, fix any null or flagged entries, then run --enrich.')
}

module.exports = { initArtistsConfig }
