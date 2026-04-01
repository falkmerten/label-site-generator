'use strict'

const https = require('https')
const querystring = require('querystring')

// Discogs allows 60 req/min with a token = 1 req/second
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
        'User-Agent': 'LabelSiteGenerator/2.0',
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

/**
 * Returns the physical format type for a release result, or null if digital-only.
 * Checks both search result format array and full release formats array.
 */
function getPhysicalFormats (formats) {
  const physical = new Set()
  if (!formats || formats.length === 0) return physical

  // formats can be strings (search results) or objects with name/descriptions (full release)
  const formatNames = formats.map(f => typeof f === 'string' ? f : (f.name || '')).map(s => s.toLowerCase())
  const formatDescs = formats.flatMap(f => typeof f === 'object' ? (f.descriptions || []) : []).map(s => s.toLowerCase())
  const all = [...formatNames, ...formatDescs]

  // Skip if digital-only
  const isDigital = all.some(s => s === 'file' || s === 'digital' || s.includes('mp3') || s.includes('flac') || s.includes('wav') || s.includes('download'))
  const hasPhysical = all.some(s =>
    s.includes('vinyl') || s === 'lp' || s.includes('cd') || s === 'cdr' ||
    s.includes('cass') || s.includes('tape') || s.includes('box') ||
    s === '7"' || s === '10"' || s === '12"'
  )
  if (isDigital && !hasPhysical) return physical

  for (const s of all) {
    if (s.includes('vinyl') || s === 'lp' || s === '7"' || s === '10"' || s === '12"') physical.add('Vinyl')
    else if (s.includes('cd') || s === 'cdr' || s === 'cdep') physical.add('CD')
    else if (s.includes('cass') || s.includes('tape')) physical.add('Cassette')
    else if (s.includes('box')) physical.add('Box Set')
  }
  return physical
}

async function searchDiscogs (token, params) {
  const qs = querystring.stringify({ ...params, token, per_page: 10, page: 1 })
  const data = await httpsGet(`https://api.discogs.com/database/search?${qs}`, token)
  if (!data || !data.results || data.results.length === 0) return null
  return data.results
}

/**
 * Fetches versions of a master release and returns per-format sell links.
 * Returns { vinyl: url|null, cd: url|null, cassette: url|null }
 */
async function getMasterVersionSellLinks (token, masterId) {
  await throttle()
  const data = await httpsGet(`https://api.discogs.com/masters/${masterId}/versions?per_page=50&page=1`, token)
  if (!data || !data.versions) return {}

  const sellLinks = {}
  for (const v of data.versions) {
    const formats = getPhysicalFormats(v.format ? [v.format] : [])
    for (const fmt of formats) {
      const key = fmt.toLowerCase()
      if (!sellLinks[key]) {
        sellLinks[key] = `https://www.discogs.com/sell/release/${v.id}`
      }
    }
    if (sellLinks.vinyl && sellLinks.cd) break // found both, stop early
  }
  return sellLinks
}

/**
 * Looks up a release on Discogs.
 * Tries UPC first, then artist+title fallback.
 * Uses master release to find per-format physical sell links.
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

  // Find the master release or best physical release
  const masterResult = results.find(r => r.type === 'master')
  const physicalResults = results.filter(r => getPhysicalFormats(r.format || []).size > 0)

  // Prefer master, then first physical, then first result
  const primaryResult = masterResult || physicalResults[0] || results[0]
  if (!primaryResult) return null

  // Aggregate all physical formats from search results
  const allFormats = new Set()
  for (const r of results) {
    for (const f of getPhysicalFormats(r.format || [])) allFormats.add(f)
  }

  // Per-format sell links
  const sellLinks = {}

  if (masterResult) {
    // Use master versions endpoint for accurate per-format sell links
    const masterSellLinks = await getMasterVersionSellLinks(token, masterResult.id)
    Object.assign(sellLinks, masterSellLinks)
  } else {
    // No master — use individual physical releases from search results
    for (const r of physicalResults) {
      const formats = getPhysicalFormats(r.format || [])
      for (const fmt of formats) {
        const key = fmt.toLowerCase()
        if (!sellLinks[key]) sellLinks[key] = `https://www.discogs.com/sell/release/${r.id}`
      }
    }
  }

  // Fetch metadata from primary result
  await throttle()
  const isMaster = primaryResult.type === 'master'
  const metaUrl = isMaster
    ? `https://api.discogs.com/masters/${primaryResult.id}`
    : `https://api.discogs.com/releases/${primaryResult.id}`
  const meta = await httpsGet(metaUrl, token)

  const labelName = meta && meta.labels && meta.labels[0] ? meta.labels[0].name : null
  const country = meta && !isMaster ? meta.country : null
  const notes = meta && meta.notes ? meta.notes : null

  // If no physical formats found at all, skip
  if (allFormats.size === 0 && Object.keys(sellLinks).length === 0) return null

  return {
    discogsUrl: `https://www.discogs.com${primaryResult.uri}`,
    discogsSellUrl: sellLinks.vinyl || sellLinks.cd || sellLinks.cassette || null,
    discogsSellUrlVinyl: sellLinks.vinyl || null,
    discogsSellUrlCd: sellLinks.cd || null,
    discogsSellUrlCassette: sellLinks.cassette || null,
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
        album.discogsSellUrlVinyl = result.discogsSellUrlVinyl
        album.discogsSellUrlCd = result.discogsSellUrlCd
        album.discogsSellUrlCassette = result.discogsSellUrlCassette
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
