'use strict'

const https = require('https')
const querystring = require('querystring')

// Discogs allows 60 req/min with a token = 1 req/second
// Use a shared queue to throttle all requests globally
const DELAY_MS = 1100

let _lastRequestTime = 0

async function throttle () {
  const now = Date.now()
  const wait = DELAY_MS - (now - _lastRequestTime)
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  _lastRequestTime = Date.now()
}

function httpsGet (url, token) {
  return new Promise((resolve) => {
    const opts = {
      headers: {
        'User-Agent': 'AenaosStaticSiteGenerator/1.0',
        Authorization: token ? `Discogs token=${token}` : undefined
      }
    }
    https.get(url, opts, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        if (res.statusCode === 429) {
          console.warn('  [discogs] Rate limited (429)')
          return resolve(null)
        }
        if (res.statusCode !== 200) return resolve(null)
        try { resolve(JSON.parse(raw)) } catch { resolve(null) }
      })
    }).on('error', () => resolve(null))
  })
}

function extractFormats (result) {
  const physical = new Set()
  // Skip digital/file/download releases entirely
  const formats = result.format || []
  const isDigitalOnly = formats.some(f => {
    const fl = f.toLowerCase()
    return fl === 'file' || fl === 'digital' || fl.includes('mp3') || fl.includes('flac') || fl.includes('wav') || fl.includes('download')
  })
  if (isDigitalOnly) return []

  for (const f of formats) {
    const fl = f.toLowerCase()
    if (fl.includes('vinyl') || fl === 'lp' || fl === '7"' || fl === '10"' || fl === '12"'
        || fl === '7' || fl === '10' || fl === '12') {
      physical.add('Vinyl')
    } else if (fl.includes('cd') || fl === 'cdr' || fl === 'cdep') {
      physical.add('CD')
    } else if (fl.includes('cass') || fl.includes('tape')) {
      physical.add('Cassette')
    } else if (fl.includes('box')) {
      physical.add('Box Set')
    }
  }
  return [...physical]
}

async function searchDiscogs (token, params) {
  const qs = querystring.stringify({ ...params, token, per_page: 10, page: 1 })
  const data = await httpsGet(`https://api.discogs.com/database/search?${qs}`, token)
  if (!data || !data.results || data.results.length === 0) return null
  return data.results // return all results
}

/**
 * Looks up a release on Discogs.
 * Tries UPC first, then artist+title fallback.
 * Aggregates formats across all matching editions.
 * Uses the most complete release (most formats/info) as the primary.
 */
async function lookupRelease (token, upc, artistName, albumTitle) {
  let results = null

  if (upc) {
    results = await searchDiscogs(token, { barcode: upc })
  }

  if (!results && artistName && albumTitle) {
    await throttle()
    results = await searchDiscogs(token, { artist: artistName, release_title: albumTitle })
  }

  if (!results || results.length === 0) return null

  // Filter to physical releases only, fall back to all if none found
  const physicalResults = results.filter(r => extractFormats(r).length > 0)
  const candidates = physicalResults.length > 0 ? physicalResults : results

  // Aggregate all physical formats
  const allFormats = new Set()
  const sellUrls = []
  let primaryResult = null

  for (const result of candidates) {
    if (!result.id) continue
    const formats = extractFormats(result)
    formats.forEach(f => allFormats.add(f))
    if (formats.length > 0) {
      sellUrls.push(`https://www.discogs.com/sell/release/${result.id}`)
      if (!primaryResult) primaryResult = result // first physical release is primary
    }
  }

  // If no physical results had formats, use first candidate for metadata only
  if (!primaryResult) primaryResult = candidates[0]
  if (!primaryResult) return null

  // Fetch full release metadata from primary physical result
  await throttle()
  const primaryRelease = await httpsGet(`https://api.discogs.com/releases/${primaryResult.id}`, token)

  const labelName = primaryRelease && primaryRelease.labels && primaryRelease.labels[0] ? primaryRelease.labels[0].name : null
  const country = primaryRelease ? primaryRelease.country : null
  const notes = primaryRelease && primaryRelease.notes ? primaryRelease.notes : null

  return {
    discogsUrl: `https://www.discogs.com${primaryResult.uri}`,
    discogsSellUrl: sellUrls[0] || `https://www.discogs.com/sell/release/${primaryResult.id}`,
    formats: [...allFormats],
    labelName,
    country,
    notes
  }
}

/**
 * Enriches albums with Discogs metadata.
 * Uses UPC lookup first, falls back to artist+title search.
 * Mutates each album in place.
 */
async function enrichAlbumsWithDiscogs (albums, artistName, token) {
  const pending = albums.filter(al => !al.discogsUrl)
  for (const album of pending) {
    try {
      await throttle()
      const result = await lookupRelease(token, album.upc, artistName, album.title)
      if (result) {
        album.discogsUrl = result.discogsUrl
        album.discogsSellUrl = result.discogsSellUrl
        if (result.formats.length > 0) album.physicalFormats = result.formats
        if (result.labelName) album.labelName = result.labelName
        if (result.country) album.country = result.country
        if (!album.description && result.notes) album.description = result.notes
        const method = album.upc ? 'UPC' : 'search'
        console.log(`    ✓ Discogs (${method}): "${album.title}"${result.formats.length ? ` → ${result.formats.join(', ')}` : ''}`)
      }
    } catch (err) {
      console.warn(`    ⚠ Discogs failed for "${album.title}": ${err.message}`)
    }
  }
}

module.exports = { enrichAlbumsWithDiscogs }
