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
    // versions endpoint returns format as a comma-separated string e.g. "LP, Album, Limited Edition"
    const formatStr = (v.format || '').toLowerCase()
    const formatParts = formatStr.split(',').map(s => s.trim())

    const isDigital = formatParts.some(s => s === 'file' || s === 'digital' || s.includes('mp3') || s.includes('flac') || s.includes('download'))
    if (isDigital) continue

    const isVinyl = formatParts.some(s => s.includes('vinyl') || s === 'lp' || s === '7"' || s === '10"' || s === '12"' || s === '7' || s === '10' || s === '12')
    const isCd = formatParts.some(s => s.includes('cd') || s === 'cdr' || s === 'cdep')
    const isCassette = formatParts.some(s => s.includes('cass') || s.includes('tape'))

    if (isVinyl && !sellLinks.vinyl) {
      sellLinks.vinyl = `https://www.discogs.com/sell/release/${v.id}`
    } else if (isCd && !sellLinks.cd) {
      sellLinks.cd = `https://www.discogs.com/sell/release/${v.id}`
    } else if (isCassette && !sellLinks.cassette) {
      sellLinks.cassette = `https://www.discogs.com/sell/release/${v.id}`
    } else if (!isVinyl && !isCd && !isCassette && !sellLinks._ambiguous) {
      // Format string is ambiguous (e.g. just "Album") — fetch full release to check
      sellLinks._ambiguous = v.id
    }

    if (sellLinks.vinyl && sellLinks.cd) break
  }

  // Resolve ambiguous version by fetching full release
  if (sellLinks._ambiguous && (!sellLinks.vinyl || !sellLinks.cd)) {
    await throttle()
    const rel = await httpsGet(`https://api.discogs.com/releases/${sellLinks._ambiguous}`, token)
    if (rel && rel.formats) {
      for (const f of rel.formats) {
        const name = (f.name || '').toLowerCase()
        if ((name.includes('cd') || name === 'cdr') && !sellLinks.cd) {
          sellLinks.cd = `https://www.discogs.com/sell/release/${sellLinks._ambiguous}`
        } else if ((name.includes('vinyl') || name === 'lp') && !sellLinks.vinyl) {
          sellLinks.vinyl = `https://www.discogs.com/sell/release/${sellLinks._ambiguous}`
        }
      }
    }
  }
  delete sellLinks._ambiguous

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

  // Only fall back to title search if we have no UPC at all
  // With a UPC that returns no results, skip — title search is too unreliable
  // for physical format detection (can match wrong release with same title)
  if (!results && !upc && artistName && albumTitle) {
    await throttle()
    results = await searchDiscogs(token, { artist: artistName, release_title: albumTitle })
  }

  if (!results || results.length === 0) return null

  // Verify results match the artist name to avoid wrong matches
  const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const targetArtist = normalise(artistName)
  const targetTitle = normalise(albumTitle)

  const verified = results.filter(r => {
    const rTitle = normalise(r.title || '')
    // Discogs title format is often "Artist - Title"
    const parts = (r.title || '').split(' - ')
    const rArtist = normalise(parts.length > 1 ? parts[0] : '')
    const rAlbum = normalise(parts.length > 1 ? parts.slice(1).join(' - ') : r.title || '')

    const artistMatch = !rArtist || rArtist.includes(targetArtist) || targetArtist.includes(rArtist)
    const titleMatch = rAlbum.includes(targetTitle) || targetTitle.includes(rAlbum) || rTitle.includes(targetTitle)
    return artistMatch && titleMatch
  })

  // Fall back to all results if verification filtered everything out
  const candidates = verified.length > 0 ? verified : results

  // Find the master release or best physical release
  const masterResult = candidates.find(r => r.type === 'master')
  const physicalResults = candidates.filter(r => getPhysicalFormats(r.format || []).size > 0)

  // Prefer master, then first physical, then first candidate
  const primaryResult = masterResult || physicalResults[0] || candidates[0]
  if (!primaryResult) return null

  // Aggregate all physical formats from candidates
  const allFormats = new Set()
  for (const r of candidates) {
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

  const rawLabel = meta && meta.labels && meta.labels[0] ? meta.labels[0] : null
  const rawLabelName = rawLabel ? rawLabel.name : null
  // Strip Discogs disambiguation numbers e.g. "Melodika (3)" → "Melodika"
  const labelName = rawLabelName ? rawLabelName.replace(/\s*\(\d+\)\s*$/, '').trim() : null
  // Skip "Not On Label" entries
  const cleanLabelName = (labelName && labelName.startsWith('Not On Label')) ? null : labelName
  // Build Discogs label URL from label ID
  const labelUrl = rawLabel && rawLabel.id ? `https://www.discogs.com/label/${rawLabel.id}` : null
  const country = meta && !isMaster ? meta.country : null
  const notes = meta && meta.notes ? meta.notes : null

  // If no physical formats found, still return label info if available (for digital-only releases)
  if (allFormats.size === 0 && Object.keys(sellLinks).length === 0) {
    if (cleanLabelName) {
      return {
        discogsUrl: `https://www.discogs.com${primaryResult.uri}`,
        discogsSellUrl: null,
        discogsSellUrlVinyl: null,
        discogsSellUrlCd: null,
        discogsSellUrlCassette: null,
        formats: [],
        labelName: cleanLabelName,
        labelUrl,
        country,
        notes
      }
    }
    return null
  }

  return {
    discogsUrl: `https://www.discogs.com${primaryResult.uri}`,
    discogsSellUrl: sellLinks.vinyl || sellLinks.cd || sellLinks.cassette || null,
    discogsSellUrlVinyl: sellLinks.vinyl || null,
    discogsSellUrlCd: sellLinks.cd || null,
    discogsSellUrlCassette: sellLinks.cassette || null,
    formats: [...allFormats],
    labelName: cleanLabelName,
    labelUrl,
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
        if (result.labelName && !album.labelName) album.labelName = result.labelName
        if (result.labelUrl && !album.labelUrl) album.labelUrl = result.labelUrl
        if (result.country && !album.country) album.country = result.country
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
